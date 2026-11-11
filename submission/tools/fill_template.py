"""Overlay the EventFlow Twin nomination text + images onto the RTA template.
Usage: python submission/tools/fill_template.py /path/to/University_Nomination_Template_RDI_Zone_.pdf
Fonts: Carlito (Linux: fonts-crosextra-carlito). On macOS, change F to a folder with Carlito or use Calibri/Arial TTFs.
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
IMG=HERE.parent/"images"
TEMPLATE=sys.argv[1] if len(sys.argv)>1 else str(HERE/"University_Nomination_Template_RDI_Zone_.pdf")  # put the RTA template here (do not commit)
OUT=str(HERE.parent/"EventFlow_Twin_RTA_Nomination_DRAFT.pdf")
F="/usr/share/fonts/truetype/crosextra/"
pdfmetrics.registerFont(TTFont("C",F+"Carlito-Regular.ttf")); pdfmetrics.registerFont(TTFont("CB",F+"Carlito-Bold.ttf")); pdfmetrics.registerFont(TTFont("CI",F+"Carlito-Italic.ttf"))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily("C",normal="C",bold="CB",italic="CI",boldItalic="CB")
W,H=960,540
S=0.6593
INK=HexColor("#1B1F2A")
def box(px):  # image px (x0,y0,x1,y1) on 1456x819 -> pdf (x,y,w,h) bottom-left origin
    x0,y0,x1,y1=[v*S for v in px]; return x0,H-y1,x1-x0,y1-y0
def text(c,px,html,maxf=10.5,minf=6.0):
    x,y,w,h=box(px)
    c.setFillColor(white); c.roundRect(x+2,y+2,w-4,h-4,7,stroke=0,fill=1)
    f=maxf
    while f>=minf:
        st=ParagraphStyle("p",fontName="C",fontSize=f,leading=f*1.22,textColor=INK)
        p=Paragraph(html,st); pw,ph=p.wrap(w-18,h-10)
        if ph<=h-10: break
        f-=0.25
    fr=Frame(x+9,y+4,w-18,h-9,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0,showBoundary=0)
    fr.addFromList([p],c)
    return f
def image(c,px,path,cap):
    x,y,w,h=box(px)
    c.setFillColor(HexColor("#FFFFFF")); c.roundRect(x+1.5,y+1.5,w-3,h-3,12,stroke=0,fill=1)
    capH=17; ir=ImageReader(path); iw,ih=ir.getSize()
    aw,ah=w-12,h-capH-10; sc=min(aw/iw,ah/ih); dw,dh=iw*sc,ih*sc
    c.drawImage(ir,x+(w-dw)/2,y+capH+4+(ah-dh)/2,dw,dh,mask='auto')
    st=ParagraphStyle("cap",fontName="CI",fontSize=6.6,leading=7.6,textColor=HexColor("#4A5060"),alignment=1)
    p=Paragraph(cap,st); p.wrap(w-12,capH); Frame(x+6,y+3,w-12,capH,0,0,0,0).addFromList([p],c)

pages={}
# ---- Page 3
def p3(c):
    text(c,(76,174,513,235),"<b>SP Jain School of Global Management, Dubai</b> – Master of Artificial Intelligence in Business (MAIB), September 2025 batch; supervised by Dr. Rachit Garg, AI Initiatives",10)
    text(c,(540,174,1376,235),"<b>EventFlow Twin: Agentic AI for Event-Ready Mobility in Dubai</b> – predicting and managing metro crowding around major events on the Sheikh Zayed Road / Trade Centre corridor",10.5)
    text(c,(76,283,513,362),"<b>Faculty lead (to confirm):</b> Dr. Rachit Garg, Assistant Professor (AI &amp; Data Science), rachit.garg@spjain.org<br/><b>Student lead:</b> Krishna Mathur, krishna.as25dxb018@spjain.org, mobile:&nbsp;+971&nbsp;50&nbsp;194&nbsp;6921",9.5)
    text(c,(540,283,1376,362),"<b>Students (MAIB, Sep 2025 batch):</b> Krishna Mathur (lead – data science, AI agents, build), Atharva Soundankar, Yash Petkar. <b>Supervisor:</b> Dr. Rachit Garg. <b>Data:</b> RTA open data – official GTFS timetable; metro ridership via Dubai Pulse / Data.Dubai – and OpenStreetMap. <b>Industry partners / funders:</b> none – independent academic prototype.",9.5)
    text(c,(76,411,513,504),"<b>Interactive digital twin demonstrator:</b> a live 3D twin of the corridor on a touch screen that visitors operate themselves (choose an event, see the crowd build, approve AI plans), plus an A1 research poster.",10)
    text(c,(540,411,939,504),"Public transport (metro), event mobility and congestion management, multimodal integration (feeder buses, robotaxis), passenger safety and accessibility.",9.5)
    text(c,(966,411,1376,504),"<b>Prototype</b> (lab validation on historical RTA open data and clearly labelled synthetic scenarios).",9.5)
    text(c,(76,557,1376,694),"Large events concentrate thousands of metro trips into a few hours at a few stations, causing crowded platforms and road congestion. EventFlow Twin is an <b>interactive digital twin demonstrator</b> that visitors operate on a touch screen. Its headline scenario replays GITEX Global 2025 at Dubai World Trade Centre: using RTA open data and the official metro timetable, it forecasts station crowding along the Sheikh Zayed Road / Trade Centre corridor and plans the response before the crowd arrives. It is designed around three RTA AI Strategy priorities. <b>Congestion reduction:</b> it shows where and when stations exceed comfortable capacity and measures how much each intervention – extra trains, feeder shuttles, robotaxi staging, staggered exits – cuts over-capacity station-hours. <b>Agentic AI:</b> AI agents propose and compare complete plans, while a deterministic simulator produces every figure. <b>Human approval:</b> no plan is applied until a planner approves it, and every decision is logged.",10)
def p4(c):
    text(c,(76,174,622,289),"Events such as GITEX Global – expected to draw upwards of 200,000 visitors to Dubai World Trade Centre over five days in October 2025 – concentrate tens of thousands of trips into a few hours at a handful of stations, causing crowded platforms, queues and road congestion. Planners need early, evidence-based answers: where and when will capacity be exceeded, and what is the best response? <b>Beneficiaries:</b> event and operations planners, metro/bus operators, visitors and residents – especially families and People of Determination.",9)
    text(c,(76,338,622,474),"<b>How it works:</b> (1) forecast hourly entries/exits per station with uncertainty bands; (2) add the event surge from venue, timing and attendance; (3) flag station-hours above 85% of practical capacity; (4) AI agents propose intervention bundles from a defined menu; (5) a deterministic simulator measures each; (6) a human approves and the twin re-simulates before/after. <b>Headline scenario:</b> GITEX Global 2025 Day 1 at Dubai World Trade Centre, replayed and to be checked against real ridership; Dubai Future Week 2026 as the forward-looking scenario.<br/><b>What is new:</b> event-aware, multimodal what-if planning with agentic AI that is auditable by design – the AI cannot invent numbers (figures come only from simulation tools and are automatically verified) and nothing is applied without human approval. Bilingual Arabic/English.",9)
    text(c,(76,523,622,660),"Python; LightGBM quantile forecasting with UAE calendar features (incl. the 2022 weekend change); transparent event-surge model with per-event timing profiles, to be calibrated against GITEX 2025 ridership; capacity from RTA’s official GTFS timetable per station and direction; break-point sensitivity analysis; deterministic intervention simulator with automated property tests; LangGraph multi-agent workflow (Claude LLM) with JSON-schema-constrained proposals and number verification; FastAPI; Next.js + deck.gl 3D map; touch-screen kiosk mode; Arabic/English RTL; offline demo mode; continuous evaluation gate (forecast accuracy vs seasonal baseline, number faithfulness, prompt-injection tests). Station-hour aggregates only – no personal data. IP: original student work (not registered). Validation results to be shared at the exhibit.",9)
    image(c,(655,177,988,395),str(IMG/"1_hero.png"),"Concept render: forecast station load at the event exit peak")
    image(c,(1015,177,1349,395),str(IMG/"2_options.png"),"AI agents propose options; a human planner approves (prototype UI)")
    image(c,(655,426,988,644),str(IMG/"3_test.png"),"Simulator test: Emirates Towers load before vs after (synthetic baseline)")
    image(c,(1015,426,1349,644),str(IMG/"4_architecture.png"),"Architecture: open data → forecast → agents → simulator → human approval")
def p5(c):
    text(c,(76,174,480,262),"<b>Tabletop.</b> Visitor touch screen (our own 24–27\" touch monitor) + laptop + A1 poster stand. Optional venue screen ≥ 50\" for an attract loop. Table approx. 1.8 m × 0.8 m. Total weight &lt; 15 kg.",9.5)
    text(c,(507,174,911,262),"2 × standard 13A UAE sockets (or one + power strip), &lt; 300 W. <b>No internet required</b> (fully offline demo). HDMI input if a venue screen is provided. No audio. Normal ambient lighting.",9.5)
    text(c,(939,174,1376,262),"Install 30 min, dismantle 15 min. No tools, no special access. Hand-carried, no crate. Done by our 3-person team; no technical staff needed from RTA.",9.5)
    text(c,(76,320,480,429),"No moving parts, lasers, liquids or sharp edges. Only standard consumer laptop/monitor batteries. Cables taped down. Visitors use the touch screen under team supervision; screen wiped regularly. No visitor data collected. No insurance or permits expected beyond standard venue rules.",9.5)
    text(c,(507,320,911,429),"Hand-carried by the team each day; no delivery, crate or storage required. Daily 10-minute system check before opening; backup device and recorded demo video on hand.",9.5)
    text(c,(939,320,1376,429),"<b>Krishna Mathur</b> (lead presenter), <b>Atharva Soundankar</b> and <b>Yash Petkar</b> – MAIB students, English; rota so 2 are always on the stand. <b>Dr. Rachit Garg</b> – faculty supervisor (to confirm). Availability: both periods. Arabic: bilingual UI and poster.",9.5)
    text(c,(76,484,704,573),"<b>Both periods:</b> 18–21 November at Emirates Towers and 23–25 November at RTA HQ (flexible to RTA’s preference).",10)
    text(c,(731,484,1376,573),"Research prototype using public RTA open data and clearly labelled synthetic / assumption-based scenarios – not an operational RTA system. Photography and filming welcome. University branding on poster. No confidential information.",9.5)
fns={2:p3,3:p4,4:p5}
r=PdfReader(TEMPLATE); w=PdfWriter()
for i,pg in enumerate(r.pages):
    if i in fns:
        buf=io.BytesIO(); c=canvas.Canvas(buf,pagesize=(W,H)); fns[i](c); c.save(); buf.seek(0)
        pg.merge_page(PdfReader(buf).pages[0])
    w.add_page(pg)
w.write(OUT); print("ok")
