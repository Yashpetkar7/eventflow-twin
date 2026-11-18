"""Overlay the EventFlow Twin nomination text + images onto the RTA template.
Usage: python submission/tools/fill_template.py <template-or-previous-draft.pdf> [output.pdf]
The input can be the blank RTA template or an earlier filled draft: every box is painted white before it is written.
Fonts: Carlito (Linux: fonts-crosextra-carlito), else Arial from macOS. Output PDFs are git-ignored (template-based).
Pictures: real 1920x1080 screenshots from submission/images/final/ (apps/web/tests/final_shots.mjs).
Every figure in the text comes from the API or eval/results/ (see submission/NOMINATION_CONTENT.md for sources).
Edit the text inside p3/p4/p5 and re-run."""
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Frame
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor, white
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter
import io, sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
IMG=HERE.parent/"images"/"final"
TEMPLATE=sys.argv[1] if len(sys.argv)>1 else str(HERE/"University_Nomination_Template_RDI_Zone_.pdf")  # put the RTA template here (do not commit)
OUT=sys.argv[2] if len(sys.argv)>2 else str(HERE.parent/"EventFlow_Twin_RTA_Nomination_DRAFT.pdf")
FONTS=[("/usr/share/fonts/truetype/crosextra/","Carlito-Regular.ttf","Carlito-Bold.ttf","Carlito-Italic.ttf"),
       ("/System/Library/Fonts/Supplemental/","Arial.ttf","Arial Bold.ttf","Arial Italic.ttf")]
F,FR,FB,FI=next(f for f in FONTS if Path(f[0],f[1]).exists())
SCALE=1.0 if "Carlito" in FR else 0.93      # Arial runs wider than Carlito
pdfmetrics.registerFont(TTFont("C",F+FR)); pdfmetrics.registerFont(TTFont("CB",F+FB)); pdfmetrics.registerFont(TTFont("CI",F+FI))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily("C",normal="C",bold="CB",italic="CI",boldItalic="CB")
# Personal contact details live in a git-ignored file, not in this public script:
#   submission/tools/contact.local.json  {"student_email": "...", "mobile": "+971&nbsp;..."}
import json
_c=HERE/"contact.local.json"
if _c.exists():
    _d=json.loads(_c.read_text(encoding="utf-8")); CONTACT=f"{_d['student_email']}, mobile:&nbsp;{_d['mobile']}"
else:
    CONTACT="[student email and mobile – add submission/tools/contact.local.json]"; print("warning: contact.local.json missing")
W,H=960,540
S=0.6593
INK=HexColor("#1B1F2A")
def box(px):  # image px (x0,y0,x1,y1) on 1456x819 -> pdf (x,y,w,h) bottom-left origin
    x0,y0,x1,y1=[v*S for v in px]; return x0,H-y1,x1-x0,y1-y0
def text(c,px,html,maxf=10.5,minf=6.0):
    x,y,w,h=box(px)
    c.setFillColor(white); c.roundRect(x+2,y+2,w-4,h-4,7,stroke=0,fill=1)
    f=maxf*SCALE; minf=minf*SCALE
    while f>=minf:
        st=ParagraphStyle("p",fontName="C",fontSize=f,leading=f*1.22,textColor=INK)
        p=Paragraph(html,st); pw,ph=p.wrap(w-18,h-10)
        if ph<=h-10: break
        f-=0.25
    fr=Frame(x+9,y+4,w-18,h-9,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0,showBoundary=0)
    fr.addFromList([p],c)
    if f<8.2: print("small text %.2fpt: %s…" % (f, html[:40]))
    return f
def image(c,px,path,cap,crop=None):
    """crop = (x0,y0,x1,y1) in screenshot pixels; the crop is downscaled to 1100 px wide JPEG to keep the PDF small."""
    from PIL import Image
    x,y,w,h=box(px)
    c.setFillColor(HexColor("#FFFFFF")); c.roundRect(x+1.5,y+1.5,w-3,h-3,12,stroke=0,fill=1)
    im=Image.open(path).convert("RGB")
    if crop: im=im.crop(crop)
    if im.width>1100: im=im.resize((1100,round(im.height*1100/im.width)),Image.LANCZOS)
    jb=io.BytesIO(); im.save(jb,"JPEG",quality=88); jb.seek(0)
    capH=17; ir=ImageReader(jb); iw,ih=ir.getSize()
    aw,ah=w-12,h-capH-10; sc=min(aw/iw,ah/ih); dw,dh=iw*sc,ih*sc
    c.drawImage(ir,x+(w-dw)/2,y+capH+4+(ah-dh)/2,dw,dh,mask='auto')
    st=ParagraphStyle("cap",fontName="CI",fontSize=6.6,leading=7.6,textColor=HexColor("#4A5060"),alignment=1)
    p=Paragraph(cap,st); p.wrap(w-12,capH); Frame(x+6,y+3,w-12,capH,0,0,0,0).addFromList([p],c)

pages={}
# ---- v4 text (18 Nov 2026). Sources of every figure: docs/RTA_NOMINATION_DRAFT.md.
# ---- Page 3
def p3(c):
    text(c,(76,174,513,235),"<b>SP Jain School of Global Management, Dubai</b> – Master of Artificial Intelligence in Business (MAIB), September 2025 batch; supervised by Dr. Rachit Garg, AI Initiatives",10)
    text(c,(540,174,1376,235),"<b>EventFlow Twin: Agentic AI for Event-Ready Mobility in Dubai</b> – predicting and managing metro crowding around major events on the Sheikh Zayed Road / Trade Centre corridor",10.5)
    text(c,(76,283,513,362),"<b>Faculty lead (to confirm):</b> Dr. Rachit Garg, Assistant Professor (AI &amp; Data Science), rachit.garg@spjain.org<br/><b>Student lead:</b> Krishna Mathur, "+CONTACT,9.5)
    text(c,(540,283,1376,362),"<b>Students (MAIB, Sep 2025 batch):</b> Krishna Mathur (lead – data science, AI agents, build), Atharva Soundankar, Yash Petkar. <b>Supervisor:</b> Dr. Rachit Garg. <b>Data:</b> RTA open data (official GTFS metro timetable), OpenStreetMap; station demand is synthetic and labelled until RTA ridership (Dubai Pulse) is obtained. <b>Industry partners / funders:</b> none – independent academic prototype.",9.5)
    text(c,(76,411,513,504),"<b>Interactive digital twin demonstrator:</b> a live 3D twin of the corridor on a touch screen that visitors operate themselves – choose or describe an event, see the crowd build, answer the AI team’s questions, edit and approve its plans – plus an A1 research poster.",10)
    text(c,(540,411,939,504),"Public transport (metro), event mobility and congestion management, multimodal integration (feeder buses, robotaxis), incident response, passenger safety and accessibility.",9.5)
    text(c,(966,411,1376,504),"<b>Prototype</b> (working software; lab validation on RTA’s official timetable and clearly labelled synthetic demand scenarios). Not connected to any RTA system.",9.5)
    text(c,(76,557,1376,694),"Large events concentrate tens of thousands of metro trips into a few hours at a few stations. EventFlow Twin is an <b>agentic AI digital twin</b> that plans the response before the crowd arrives. It replays GITEX Global 2025 at Dubai World Trade Centre on RTA’s official metro timetable, with labelled synthetic demand. <b>Agentic AI:</b> 18 AI agents work like an operations room – a watcher raises the alert hours ahead, specialists for rail, stations, venue and last mile size their measures, a critic challenges every plan on seven criteria, and a deterministic simulator produces every figure. <b>Human-led:</b> the team asks the planner at decision points; nothing is applied until a human approves, and every decision is logged. People can type in English or Arabic to change the scenario. <b>Congestion reduction:</b> it shows where and when stations exceed comfortable capacity and how much each measure relieves them. Runs fully offline.",10)
def p4(c):
    text(c,(76,174,622,289),"Events such as GITEX Global – expected to draw upwards of 200,000 visitors to Dubai World Trade Centre over five days in October 2025 – concentrate tens of thousands of trips into a few hours at a handful of stations, causing crowded platforms, queues and road congestion. Planners need early, evidence-based answers: where and when will capacity be exceeded, and which response works best? <b>Beneficiaries:</b> operations planners, duty managers, operators, visitors and residents, including people of determination.",9)
    text(c,(76,338,622,474),"<b>How it works:</b> (1) forecast station demand and add the event surge; (2) simulate every station in 15-minute steps against timetable capacity; (3) specialist agents propose measures sized to the gap; (4) the simulator tests each plan, a critic checks seven criteria, and the team replans when none meets the goal; (5) the team asks the human at decision points, who can edit, approve or reject. <b>Headline scenario (simulated, synthetic demand):</b> GITEX 2025 Day 1, 40,000 assumed visitors: World Trade Centre peaks at 78% of comfortable capacity and tips over at about 44,400. On a hot day it reaches 92%; the recommended plan (exits spread over 45 more minutes, 10% of riders guided to Emirates Towers) brings it to 74%, passing all 6 applicable checks.<br/><b>What is new:</b> agents that cannot invent numbers and that ask before they act; visitors type or tap on the kiosk. Arabic/English.",9)
    text(c,(76,523,622,660),"Python, FastAPI; LangGraph graph of 18 agents (8 can call a language model, 10 are code only); weekday-profile forecast with the UAE calendar (backtest MASE 0.77 vs 0.97 for the seasonal baseline, synthetic data); capacity from RTA’s official GTFS timetable; break-point analysis; deterministic 15-minute simulator (139 property checks); assistant with typed scenario changes, cited documents and graded confidence; Next.js + react-three-fiber 3D twin from open map data; touch kiosk with a built-in English/Arabic keyboard; fully offline on rules and code, language models optional behind the same checks. CI evaluation gate: number faithfulness 132 of 132 plan options (60 scenarios); 0 of 53 attack cases succeeded; 15 of 15 incident shifts applied nothing without a human; typed questions routed by word rules (17 of 24 unseen phrasings correct). Station aggregates only – no personal data. IP: original student work.",9)
    image(c,(655,177,988,395),str(IMG/"1_overview_golden_hour.png"),"3D twin from open map data – GITEX 2025 Day 1 scenario",(290,68,1520,838))
    image(c,(1015,177,1349,395),str(IMG/"2_station_closeup_ai_options.png"),"The AI team’s options for World Trade Centre; every figure from the simulator",(560,68,1920,1000))
    image(c,(655,426,988,644),str(IMG/"7_kiosk_ai_keyboard.png"),"Kiosk: visitors type or tap to change the scenario (built-in English/Arabic keyboard)",(60,84,1920,1030))
    image(c,(1015,426,1349,644),str(IMG/"8_team_asks_the_visitor.png"),"Human in the loop: the team tests harder cases itself, then asks which to plan for",(420,84,1920,1030))
def p5(c):
    text(c,(76,174,480,262),"<b>Tabletop.</b> Visitor touch screen (our own 24–27\" touch monitor) + laptop + A1 poster stand. Optional venue screen ≥ 50\" for an attract loop. Table approx. 1.8 m × 0.8 m. Total weight &lt; 15 kg.",9.5)
    text(c,(507,174,911,262),"2 × standard 13A UAE sockets (or one + power strip), &lt; 300 W. <b>No internet required</b> (fully offline demo; the optional QR handoff uses the visitor’s own phone data). HDMI input if a venue screen is provided. No audio. Normal ambient lighting.",9.5)
    text(c,(939,174,1376,262),"Install 30 min, dismantle 15 min. No tools, no special access. Hand-carried, no crate. Done by our 3-person team; no technical staff needed from RTA.",9.5)
    text(c,(76,320,480,429),"No moving parts, lasers, liquids or sharp edges. Only standard consumer laptop/monitor batteries. Cables taped down. Visitors use the touch screen under team supervision; screen wiped regularly. No visitor data collected. No insurance or permits expected beyond standard venue rules.",9.5)
    text(c,(507,320,911,429),"Hand-carried by the team each day; no delivery, crate or storage required. Daily 10-minute system check before opening; backup device and recorded demo video on hand.",9.5)
    text(c,(939,320,1376,429),"<b>Krishna Mathur</b> (lead presenter), <b>Atharva Soundankar</b> and <b>Yash Petkar</b> – MAIB students, English; rota so 2 are always on the stand. <b>Dr. Rachit Garg</b> – faculty supervisor (to confirm). Availability: both periods. Arabic: bilingual UI and poster.",9.5)
    text(c,(76,484,704,573),"<b>Both periods:</b> 18–21 November at Emirates Towers and 23–25 November at RTA HQ (flexible to RTA’s preference).",10)
    text(c,(731,484,1376,573),"Research prototype using RTA open data (timetable) and clearly labelled synthetic / assumption-based scenarios – not an operational RTA system and not endorsed by RTA. Photography and filming welcome. University branding on poster. No confidential information.",9.5)
fns={2:p3,3:p4,4:p5}
w=PdfWriter(clone_from=TEMPLATE)          # pages belong to the writer (pypdf 5–7)
for i,pg in enumerate(w.pages):
    if i in fns:
        buf=io.BytesIO(); c=canvas.Canvas(buf,pagesize=(W,H)); fns[i](c); c.save(); buf.seek(0)
        pg.merge_page(PdfReader(buf).pages[0])
w.write(OUT); print("ok", OUT)
