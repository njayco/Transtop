"""Reproducible, fail-closed extraction of the user-supplied Trans-Bridge PDFs.

Uses rendered/text-position tables rather than whitespace splitting. Requires
PyMuPDF for development only; install using the package-management flow, then
run `uv run python .agents/scripts/import_transbridge.py`. Emits review JSON to /tmp.
Runtime application reads only the reviewed, normalized JSON, never raw PDFs.
"""
import hashlib
import json
import re
from pathlib import Path

import pymupdf as fitz

ROOT=Path(__file__).resolve().parents[2]
FILES=sorted((ROOT/"attached_assets").glob("*1793388286*.pdf"))
OUT=ROOT/"generated-artifacts/transbridge"
OUT.mkdir(parents=True,exist_ok=True)

def extract(path):
    doc=fitz.open(path)
    assert len(doc)==1,path.name
    page=doc[0]
    page.get_pixmap(matrix=fitz.Matrix(1.2,1.2)).save(str(OUT/(path.stem+".png")))
    words=page.get_text("words")
    headers=[]
    for w in words:
        if w[4]!="NUMBERS":
            continue
        runs=sorted([r for r in words if abs((r[1]+r[3]-w[1]-w[3])/2)<3
            and r[0]>=w[2]-1 and re.fullmatch(r"\d+[A-Z]*\*?",r[4])],key=lambda r:r[0])
        next_header=min([r[0] for r in words if r[4]=="RUN" and r[0]>w[2]
                         and abs(r[1]-w[1])<3] or [float("inf")])
        runs=[r for r in runs if r[0]<next_header]
        assert runs,(path.name,w)
        headers.append((w,runs))
    tables=[]
    for head,runs in headers:
        yend=min([h[0][1]-4 for h in headers if h[0][1]>head[1]+8] or
                 [w[1] for w in words if w[4]=="CODES:"] or [page.rect.height])
        first=(runs[0][0]+runs[0][2])/2
        previous=max([r[1][-1][2] for r in headers if r[0][0]<head[0]-20 and abs(r[0][1]-head[1])<5]or[0])
        anchors=[w for w in words if w[4] in ("Lv.","Ar.") and head[3]<w[1]<yend and previous<w[0]<first]
        anchor_x=max([w[0] for w in anchors]or[0])
        anchors=sorted([w for w in anchors if abs(w[0]-anchor_x)<8],key=lambda w:w[1])
        centers=[(r[0]+r[2])/2 for r in runs]
        bounds=[head[2]]+[(a+b)/2 for a,b in zip(centers,centers[1:])]+[centers[-1]+max(18,(centers[-1]-centers[-2])/2) if len(centers)>1 else page.rect.width]
        rows=[]
        for a in anchors:
            cells=[]
            for l,r in zip(bounds,bounds[1:]):
                line=sorted([w for w in words if l<(w[0]+w[2])/2<r and
                    abs((w[1]+w[3]-a[1]-a[3])/2)<3.2],key=lambda w:w[0])
                cell="".join(w[4] for w in line).replace("−","-")
                assert not cell or re.fullmatch(r"-|R|D|D?\d{1,2}:\d{2}[aApP]",cell),(path.name,a,cell)
                cells.append(cell or "-")
            rows.append({"kind":a[4],"y":round(a[1],2),"cells":cells})
        freq_words=[w for w in words if head[3]<w[1]<min([a[1] for a in anchors]or[yend])
                    and re.fullmatch(r"WD|M-TH|S/S|F|M-F|SAT|SUN",w[4])]
        frequencies=[]
        gates=[]
        for l,r in zip(bounds,bounds[1:]):
            frequencies.append("".join(w[4] for w in freq_words if l<(w[0]+w[2])/2<r))
            gate_rows=[w for w in words if w[4]=="GATE" and head[3]<w[1]<yend and previous<w[0]<first]
            gs=[w[4] for w in words if any(abs(w[1]-g[1])<3 for g in gate_rows)
                and l<(w[0]+w[2])/2<r and re.fullmatch(r"[246]",w[4])]
            gates.append("".join(gs))
        tables.append({"runs":[r[4] for r in runs],"frequencies":frequencies,"gates":gates,"rows":rows})
    return {"file":path.name,"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),"tables":tables}

def manifest(file):
    name=file["file"].split("_179")[0]
    holiday="11-26-11-27" in name
    master=name.startswith(("Allentown-","Doylestown-"))
    if name.startswith("Allentown"):
        route="allentown-"+("east" if "Eastbound" in name else "west")
    elif name.startswith("Doylestown"):
        route="doylestown-"+("east" if "-East-" in name else "west")
    elif name.startswith("Newark"):
        route="allentown-"+("east" if "-To-" in name else "west")
    else:
        route=""
    month="2026/10" if holiday else "2026/03" if "Doylestown" in name else "2025/07" if "Wall-Street" in name else "2026/07" if "7-10-26" in name else "2026/05"
    file.update({"sourceUrl":f"https://transbridgelines.com/wp-content/uploads/{month}/{name}.pdf",
                 "role":"primary" if master else "existing-wall" if "Wall-Street" in name else "cross-check",
                 "holiday":holiday})
    for table in file["tables"]:
        weekend=table["frequencies"][0]=="S/S"
        if name.startswith("Allentown"):
            if route.endswith("east"):
                codes="WES ATC BTC ABE WC HEL WPH EAS CLI EWR NY CRU" if weekend else "ATC BTC ABE WES HEL WC WPH EAS CLI EWR NY CRU"
            else:
                codes="CRU NY EWR ANN CLI EAS WPH HEL WC BTC ABE ATC WES" if not holiday and not weekend else "CRU NY EWR CLI EAS WPH WC ABE BTC HEL WES ATC"
        elif name.startswith("Doylestown"):
            codes="QUA DOY LAH NHO LAM FLE BRA NY" if route.endswith("east") else "NY BRA FLE LAM NHO LAH DOY QUA"
        elif name.startswith("Newark-To"):
            codes="WES ATC BTC ABE WC HEL WPH EAS CLI EWR"
        elif name.startswith("Newark-from"):
            codes="EWR ANN CLI EAS WPH HEL WC ABE BTC ATC WES" if holiday else "EWR CLI EAS WPH HEL WC BTC ABE ATC WES"
        elif name.startswith("Wind"):
            west=table["runs"][0] in ("100","202","500")
            route="allentown-"+("west" if west else "east")
            codes=("NY EWR CLI EAS WPH WC" if holiday else "NY EWR CLI EAS WPH ABE WC") if west else "WC HEL WPH EAS CLI EWR NY"
        else:
            east=table["runs"][0]=="401"
            route="wall-"+("east" if east else "west")
            codes="ABE WPH ANN VAR BTH BWA BCE BRE WBR-E WWA" if east else "WBR-W BRI TRI CMU CRE ANN WPH ABE"
        assert len(codes.split())==len(table["rows"]),(name,codes,len(table["rows"]))
        table["routeId"]="transbridge:"+route
        table["stopIds"]=["transbridge:"+c for c in codes.split()]
        table["effectiveDate"]="2026-11-26" if holiday else "2026-03-09" if "Doylestown" in name else "2025-07-25" if "Wall-Street" in name else "2026-07-10" if "7-10-26" in name and not weekend else "2026-06-08"
    return file

if __name__=="__main__":
    assert len(FILES)==15,"Expected the exact 15 uploaded sources"
    output=[manifest(extract(f))for f in FILES]
    Path("/tmp/transbridge-tables.json").write_text(json.dumps(output,indent=2))
    target=ROOT/"artifacts/api-server/src/transit/intercity/transbridge-tables.json"
    target.write_text(json.dumps(output,ensure_ascii=False,separators=(",",":"))+"\n")
    for f in output:
        print(f["file"])
        for t in f["tables"]:
            print("  runs",t["runs"],"frequency",t["frequencies"],"gates",t["gates"])
            print("  rows",len(t["rows"]))
            for row in t["rows"]:
                print("   ",row["kind"]," ".join(row["cells"]))
