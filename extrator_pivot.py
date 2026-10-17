#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extrator PIVOT Deal Manager
===========================

Roda LOCALMENTE na maquina do usuario (nao no servidor web). Duas funcoes:

1) `extrair`: le um arquivo de proposta de pivo (.xlsb), extrai os dados de
   cliente/tecnicos/monetarios, organiza o arquivo original na pasta
   Cliente/Estado/Municipio/Fazenda (com versionamento v2, v3...) e envia
   os dados extraidos para a API web (Supabase fica so com os dados, o
   arquivo fica no computador do usuario).

2) `sincronizar-desconto`: pega as mudancas de desconto feitas no dashboard
   web (fila em /log_desconto/pendentes) e escreve o novo % na planilha
   "Calculadora" (.xlsm) do cliente, SEM recalcular nada aqui -- so troca a
   celula de entrada e salva uma nova versao; o Excel recalcula sozinho na
   formula quando o usuario abrir o arquivo (todas as formulas da
   Calculadora sao preservadas, nao sao tocadas).

Uso:
    python extrator_pivot.py extrair --pasta-entrada "C:/.../novos" \
        --pasta-base "C:/Users/lopes/Documents/vendas_pivot/clientes" \
        --api http://localhost:3000 --token <JWT> --projeto-id <uuid>

    python extrator_pivot.py sincronizar-desconto \
        --api http://localhost:3000 --token <JWT>

Dependencias: pip install pyxlsb openpyxl requests
"""
import argparse
import os
import re
import shutil
import sys

import requests

try:
    import pyxlsb
except ImportError:
    pyxlsb = None

try:
    import openpyxl
except ImportError:
    openpyxl = None


# ---------------------------------------------------------------------------
# 1) EXTRACAO da proposta individual (.xlsb) -- coordenadas validadas contra
#    5 arquivos reais do cliente Horacio Camargo Lacerda Junior (todas batem).
#    (linha, coluna) sao 0-based, como pyxlsb entrega via Cell.c e o indice
#    de linha do iterador de rows().
# ---------------------------------------------------------------------------
PROPOSTA_MAP = {
    "nome": (3, 5),
    "proposta": (3, 14),
    "pivo_opcao": (3, 18),
    "propriedade": (5, 5),
    "municipio": (5, 14),
    "estado": (5, 18),
    "modelo": (6, 9),
    "marca": (6, 11),
    "composicao": (7, 5),
}
# bloco de totais (linha 260 = TOTAL GERAL A+B+C+D; linha 259 = Sub Total D - PIVO)
TOTAIS_ROW = 260
SUBTOTAL_D_ROW = 259
TOTAIS_MAP = {
    "preco_total": (TOTAIS_ROW, 28),        # J - TOTAL GERAL
    "montagem": (TOTAIS_ROW, 26),
    "servicos_adicionais": (TOTAIS_ROW, 27),
}
PRECO_PARTE_AEREA_CELL = (SUBTOTAL_D_ROW, 28)  # K - Sub Total D - PIVO

FICHA_TECNICA_MAP = {
    "composicao_ficha": (6, 2),
    "area_irrigada_ha": (23, 9),
}


def _ler_xlsb_celulas(caminho, aba, coords_desejadas):
    """Le so as celulas pedidas de uma aba .xlsb. coords_desejadas: set de (row,col)."""
    encontrado = {}
    with pyxlsb.open_workbook(caminho) as wb:
        if aba not in wb.sheets:
            return encontrado
        with wb.get_sheet(aba) as sheet:
            for r_idx, row in enumerate(sheet.rows()):
                for cell in row:
                    if cell.v is None:
                        continue
                    key = (r_idx, cell.c)
                    if key in coords_desejadas:
                        encontrado[key] = cell.v
    return encontrado


def extrair_pivo_xlsb(caminho_arquivo):
    """Extrai um dict com os campos do pivo a partir do arquivo de proposta .xlsb."""
    if pyxlsb is None:
        raise RuntimeError("pyxlsb nao instalado: pip install pyxlsb")

    coords_proposta = set(PROPOSTA_MAP.values()) | set(TOTAIS_MAP.values()) | {PRECO_PARTE_AEREA_CELL}
    valores_proposta = _ler_xlsb_celulas(caminho_arquivo, "PROPOSTA", coords_proposta)

    coords_ficha = set(FICHA_TECNICA_MAP.values())
    valores_ficha = _ler_xlsb_celulas(caminho_arquivo, "FICHA_TECNICA", coords_ficha)

    dado = {}
    for campo, coord in PROPOSTA_MAP.items():
        dado[campo] = valores_proposta.get(coord)
    for campo, coord in TOTAIS_MAP.items():
        dado[campo] = valores_proposta.get(coord) or 0
    dado["preco_parte_aerea"] = valores_proposta.get(PRECO_PARTE_AEREA_CELL) or 0
    dado["area_irrigada_ha"] = valores_ficha.get(FICHA_TECNICA_MAP["area_irrigada_ha"])

    # numero_pivo: vem do nome do arquivo (padrao "PC 05", "PC_05" etc.) como
    # fallback caso o campo "pivo_opcao" da planilha nao venha nesse formato.
    m = re.search(r"PC[\s_-]*0*(\d+)", os.path.basename(caminho_arquivo), re.IGNORECASE)
    dado["numero_pivo"] = ("PC %02d" % int(m.group(1))) if m else str(dado.get("pivo_opcao") or "").strip()
    dado["nome_arquivo_original"] = os.path.basename(caminho_arquivo)
    return dado


# ---------------------------------------------------------------------------
# 2) ORGANIZACAO local: Cliente > Estado > Municipio > Fazenda > (versoes v2,v3...)
# ---------------------------------------------------------------------------
def _slug_pasta(texto):
    texto = (texto or "SEM_INFO").strip()
    texto = re.sub(r"[\\/:*?\"<>|]+", "_", texto)
    texto = re.sub(r"\s+", "_", texto)
    return texto.upper()[:80]


def organizar_arquivo(caminho_origem, pasta_base, cliente, estado, municipio, fazenda):
    """
    Copia o arquivo original para pasta_base/Cliente/Estado/Municipio/Fazenda/,
    renomeando para v2, v3... se ja existir um arquivo com o mesmo nome base
    naquela pasta (todas as versoes ficam juntas, nenhuma e sobrescrita).
    Retorna (caminho_destino, numero_da_revisao).
    """
    pasta_destino = os.path.join(
        pasta_base,
        _slug_pasta(cliente),
        _slug_pasta(estado),
        _slug_pasta(municipio),
        _slug_pasta(fazenda),
    )
    os.makedirs(pasta_destino, exist_ok=True)

    nome_original = os.path.basename(caminho_origem)
    base, ext = os.path.splitext(nome_original)
    # remove sufixo _vN se o arquivo de origem ja tiver um, pra nao duplicar
    base_sem_versao = re.sub(r"_v\d+$", "", base, flags=re.IGNORECASE)

    existentes = [f for f in os.listdir(pasta_destino) if f.lower().startswith(base_sem_versao.lower())]
    if not existentes:
        nome_destino = nome_original
        revisao = 1
    else:
        revisao = len(existentes) + 1
        nome_destino = "%s_v%d%s" % (base_sem_versao, revisao, ext)

    caminho_destino = os.path.join(pasta_destino, nome_destino)
    shutil.copy2(caminho_origem, caminho_destino)
    return caminho_destino, revisao


# ---------------------------------------------------------------------------
# 3) ENVIO para a API web
# ---------------------------------------------------------------------------
def enviar_pivo_api(api_base, token, projeto_id, dado, caminho_local):
    payload = {
        "projeto_id": projeto_id,
        "numero_pivo": dado.get("numero_pivo"),
        "composicao": dado.get("composicao") or dado.get("composicao_ficha"),
        "propriedade": dado.get("propriedade"),
        "municipio": dado.get("municipio"),
        "estado": dado.get("estado"),
        "marca": dado.get("marca"),
        "modelo": dado.get("modelo"),
        "area_irrigada_ha": dado.get("area_irrigada_ha"),
        "montagem": dado.get("montagem"),
        "servicos_adicionais": dado.get("servicos_adicionais"),
        "preco_total": dado.get("preco_total"),
        "preco_parte_aerea": dado.get("preco_parte_aerea"),
        "nome_arquivo_original": dado.get("nome_arquivo_original"),
        "caminho_local": caminho_local,
    }
    r = requests.post(
        api_base.rstrip("/") + "/pivos",
        json=payload,
        headers={"Authorization": "Bearer " + token},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def cmd_extrair(args):
    arquivos = [
        os.path.join(args.pasta_entrada, f)
        for f in os.listdir(args.pasta_entrada)
        if f.lower().endswith(".xlsb")
    ]
    if not arquivos:
        print("Nenhum .xlsb encontrado em", args.pasta_entrada)
        return
    for caminho in arquivos:
        print("Lendo", caminho)
        dado = extrair_pivo_xlsb(caminho)
        cliente = args.cliente or dado.get("nome")
        estado = dado.get("estado") or args.estado
        municipio = dado.get("municipio") or args.municipio
        fazenda = args.fazenda or dado.get("propriedade")
        destino, revisao = organizar_arquivo(caminho, args.pasta_base, cliente, estado, municipio, fazenda)
        print("  -> organizado em", destino, "(revisao", revisao, ")")
        resultado = enviar_pivo_api(args.api, args.token, args.projeto_id, dado, destino)
        print("  -> pivo", resultado.get("numero_pivo"), "salvo no sistema, valor_negociado=", resultado.get("valor_negociado"))


# ---------------------------------------------------------------------------
# 4) SINCRONIZACAO de desconto -> escreve de volta na Calculadora .xlsm,
#    preservando TODAS as formulas (so troca a celula de entrada F<linha>).
#    O Excel recalcula sozinho quando o arquivo for reaberto.
# ---------------------------------------------------------------------------
def escrever_desconto_calculadora(caminho_calculadora, linha_calculadora, novo_desconto_pct):
    if openpyxl is None:
        raise RuntimeError("openpyxl nao instalado: pip install openpyxl")
    wb = openpyxl.load_workbook(caminho_calculadora, data_only=False, keep_vba=True)
    ws = wb["Calculo"]
    ws["F%d" % linha_calculadora] = novo_desconto_pct
    # garante recalculo automatico ao abrir
    try:
        wb.calculation.fullCalcOnLoad = True
    except Exception:
        pass

    base, ext = os.path.splitext(caminho_calculadora)
    base_sem_versao = re.sub(r"_v\d+$", "", base, flags=re.IGNORECASE)
    pasta = os.path.dirname(caminho_calculadora)
    existentes = [f for f in os.listdir(pasta) if f.lower().startswith(os.path.basename(base_sem_versao).lower())]
    revisao = len(existentes) + 1
    novo_caminho = "%s_v%d%s" % (base_sem_versao, revisao, ext)
    wb.save(novo_caminho)
    return novo_caminho


def cmd_sincronizar_desconto(args):
    r = requests.get(
        args.api.rstrip("/") + "/log_desconto/pendentes",
        headers={"Authorization": "Bearer " + args.token},
        timeout=30,
    )
    r.raise_for_status()
    pendentes = r.json()
    if not pendentes:
        print("Nenhuma alteracao de desconto pendente.")
        return
    for item in pendentes:
        pivo = item.get("pivos") or {}
        projeto_id = pivo.get("projeto_id")
        linha = pivo.get("linha_calculadora")
        if not linha:
            print("  [pulado] pivo", pivo.get("numero_pivo"), "sem linha_calculadora definida -- precisa mapear manualmente")
            continue
        pr = requests.get(
            args.api.rstrip("/") + "/projetos",
            headers={"Authorization": "Bearer " + args.token},
            timeout=30,
        ).json()
        projeto = next((p for p in pr if p["id"] == projeto_id), None)
        caminho_calc = projeto and projeto.get("caminho_local_calculadora")
        if not caminho_calc or not os.path.exists(caminho_calc):
            print("  [pulado] Calculadora nao encontrada para projeto", projeto_id, "-> configure caminho_local_calculadora")
            continue
        novo_caminho = escrever_desconto_calculadora(caminho_calc, linha, item["desconto_novo"])
        print("  -> desconto do pivo", pivo.get("numero_pivo"), "atualizado em", novo_caminho)
        requests.put(
            args.api.rstrip("/") + "/log_desconto/%s/sincronizado" % item["id"],
            headers={"Authorization": "Bearer " + args.token},
            timeout=30,
        )


def main():
    p = argparse.ArgumentParser(description="Extrator e organizador de pivos PIVOT")
    sub = p.add_subparsers(dest="comando", required=True)

    pe = sub.add_parser("extrair", help="Extrai .xlsb de uma pasta, organiza e envia para a API")
    pe.add_argument("--pasta-entrada", required=True)
    pe.add_argument("--pasta-base", required=True, help="Pasta raiz onde ficam Cliente/Estado/Municipio/Fazenda")
    pe.add_argument("--api", required=True)
    pe.add_argument("--token", required=True)
    pe.add_argument("--projeto-id", required=True)
    pe.add_argument("--cliente", default=None)
    pe.add_argument("--estado", default=None)
    pe.add_argument("--municipio", default=None)
    pe.add_argument("--fazenda", default=None)
    pe.set_defaults(func=cmd_extrair)

    ps = sub.add_parser("sincronizar-desconto", help="Aplica mudancas de desconto pendentes na Calculadora .xlsm local")
    ps.add_argument("--api", required=True)
    ps.add_argument("--token", required=True)
    ps.set_defaults(func=cmd_sincronizar_desconto)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
