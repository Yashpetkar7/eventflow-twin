"""Two talk scripts as PDFs → exhibit/pitch/
    EventFlow_Twin_Script_for_RTA.pdf            what the team says at the booth
    EventFlow_Twin_Script_for_Dr_Rachit.pdf      what the team says to the professor, and what we need from him

    python exhibit/pitch/build/build_scripts.py
Every figure comes from exhibit/pitch/build/facts.json (the running API and eval/results/*.json). Plain language.
No personal contact details. The live link appears only in the professor's copy.
"""
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

HERE = Path(__file__).resolve().parent
OUT = HERE.parent
F = json.loads((HERE / "facts.json").read_text(encoding="utf-8"))
FONTS = [("/usr/share/fonts/truetype/crosextra/", "Carlito-Regular.ttf", "Carlito-Bold.ttf", "Carlito-Italic.ttf"),
         ("/System/Library/Fonts/Supplemental/", "Arial.ttf", "Arial Bold.ttf", "Arial Italic.ttf")]
D, R, B, I = next(f for f in FONTS if Path(f[0], f[1]).exists())
pdfmetrics.registerFont(TTFont("T", D + R)); pdfmetrics.registerFont(TTFont("TB", D + B)); pdfmetrics.registerFont(TTFont("TI", D + I))
registerFontFamily("T", normal="T", bold="TB", italic="TI", boldItalic="TB")

NAVY, INK, MUTED, TINT, GREEN, RED = (colors.HexColor(x) for x in ("#0B1B4D", "#151B28", "#5B6B8C", "#F2F4F8", "#0E7A55", "#B0124F"))
ST = {
    "title": ParagraphStyle("title", fontName="TB", fontSize=22, leading=27, textColor=NAVY, spaceAfter=3),
    "sub": ParagraphStyle("sub", fontName="T", fontSize=11.5, leading=16, textColor=MUTED, spaceAfter=10),
    "h": ParagraphStyle("h", fontName="TB", fontSize=13.5, leading=18, textColor=NAVY, spaceBefore=13, spaceAfter=5),
    "p": ParagraphStyle("p", fontName="T", fontSize=10.5, leading=15.2, textColor=INK, spaceAfter=5, alignment=TA_LEFT),
    "li": ParagraphStyle("li", fontName="T", fontSize=10.5, leading=15.2, textColor=INK, leftIndent=13, bulletIndent=2, spaceAfter=2.5),
    "say": ParagraphStyle("say", fontName="TI", fontSize=11, leading=16.2, textColor=INK),
    "cell": ParagraphStyle("cell", fontName="T", fontSize=9.8, leading=13.6, textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="TB", fontSize=9.8, leading=13.6, textColor=INK),
    "head": ParagraphStyle("head", fontName="TB", fontSize=9.8, leading=13.6, textColor=colors.white),
}
P = lambda t, s="p": Paragraph(t, ST[s])                       # noqa: E731
H = lambda t: Paragraph(t, ST["h"])                            # noqa: E731
pct = lambda x: f"{round(x * 100)}%"                           # noqa: E731
num = lambda x: f"{round(x):,}"                                # noqa: E731


def bullets(items):
    return [Paragraph(t, ST["li"], bulletText="•") for t in items]


def say(text):
    """Words to say out loud, in a tinted box."""
    t = Table([[Paragraph(text, ST["say"])]], colWidths=[170 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), TINT), ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#D5DBE7")),
                           ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                           ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 9)]))
    return t


def table(header, rows, widths, bold_first=True):
    data = [[Paragraph(h, ST["head"]) for h in header]] + [
        [Paragraph(c, ST["cellb" if bold_first and j == 0 else "cell"]) for j, c in enumerate(r)] for r in rows]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), NAVY), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, TINT]), ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#D5DBE7")),
                           ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                           ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return t


def build(name, title, story):
    def page(canvas, doc):
        canvas.saveState()
        canvas.setFont("T", 8.5); canvas.setFillColor(MUTED)
        canvas.drawString(20 * mm, 11 * mm, f"{title}  ·  13 November 2026  ·  research prototype, synthetic demand")
        canvas.drawRightString(190 * mm, 11 * mm, f"Page {doc.page}")
        canvas.restoreState()
    doc = SimpleDocTemplate(str(OUT / name), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=19 * mm,
                            title=title, author="Krishna Mathur, Atharva Soundankar, Yash Petkar")
    doc.build(story, onFirstPage=page, onLaterPages=page)
    print("wrote", OUT / name)


sc, ev, rp = F["scenarios"], F["eval"], F["replan"]
hot, rain, normal = sc["hot"], sc["rain"], sc["normal"]
ratios = [v for v in F["real_ratio"].values() if v > 1]

# ============================================================== 1. the booth script for RTA
rta = [
    P("EventFlow Twin: what we say to RTA", "title"),
    P("Booth script for the R&amp;D and Innovation Zone. 18–21 November at Emirates Towers, 23–25 November at RTA Head Office.", "sub"),
    H("Three rules before you speak"),
    *bullets(["<b>Say “designed for RTA’s priorities”.</b> Never say “used by”, “approved by” or “with” RTA.",
              "<b>Say “the demand is synthetic” in your first minute.</b> Do not wait to be asked.",
              "<b>Let the visitor touch the screen.</b> One of us talks, the other keeps hands off."]),
    H("The opener (20 seconds)"),
    say("“When thousands of people leave an event at once, which metro station breaks first, and what would you do about it? "
        "This is a planning twin of the Sheikh Zayed Road corridor. It forecasts the crowd, AI agents propose a plan, and a person approves it. "
        "It is a student research prototype, and the demand in it is synthetic. Would you like to try?”"),
    H("The two-minute demo"),
    table(["Step", "Touch", "Say"], [
        ["1  Start", "“Touch to start”, then “I’m planning the event”.", "“You are the event planner today.”"],
        ["2  Pick the event", "GITEX Global, then “Hot day”.", f"“On a hot day more visitors take the metro. We assume {pct(hot['metro_share'])} instead of {pct(normal['metro_share'])}.”"],
        ["3  Guess", "Let them pick the station they think is busiest.", f"“World Trade Centre reaches {pct(hot['peak'])} of comfortable capacity. The comfort line is 85%.”"],
        ["4  Stress it", "“Stress test”: drag the crowd, change the metro share.", f"“The station tips over at about {num(F['break']['attendance'])} visitors. And look at the road: more people on the metro means fewer cars.”"],
        ["5  Ask the AI", "“Ask the AI for a plan”, then “Not sure. Ask the AI”.", f"“Three plans, each one measured by the simulator. The first one is signs: guide 35% of riders on foot to Emirates Towers. Peak load goes from {pct(hot['peak'])} to {pct(hot['top']['peak'])}.”"],
        ["6  Show the working", "“How did the AI decide?”, then “Show all tool calls”.", "“Every step is here with its run number. The AI never writes a number itself. A separate check re-reads every figure.”"],
        ["7  Approve", "“Approve this plan”.", "“Nothing happens until a person approves. Every approval is logged.”"],
        ["8  If they stay", "Touch the Burj Khalifa or the Museum of the Future.", "“The city is built from open map data. The landmarks are our own models.”"],
    ], [24, 62, 84]),
    Spacer(1, 4),
    P("<b>Only one minute?</b> Press “Show me in 60 seconds” on the second screen. It plays the same story with captions; any touch takes over."),
    H("If the visitor is an AI person (one minute)"),
    say("“The planner is a loop, not one pass. It proposes plans, the simulator measures each one, and a critic checks the goal. "
        f"If no plan clears every station, it tries again with stronger and combined measures, at most twice. With twice the crowd on the downtown night it took {rp['rounds']} rounds and {rp['sims']} simulations. "
        f"We test it: {ev['agents']['metrics']['options_checked']} of {ev['agents']['metrics']['options_checked']} plan options have every number traced to the simulator, "
        f"and none of {ev['redteam']['n']} attack cases succeeds. "
        "To be honest about one thing: the planner you see is rule-based. A language model can take the proposing and explaining steps, and we tested that path with a stand-in model, but we have not yet run a real model through it.”"),
    H("If the visitor plans transport (one minute)"),
    say("“The menu is measures you already use: extra trains, signs to the next station, feeder shuttles, staged robotaxis, staggered exits, and entry metering at the gates. "
        "For each event the twin gives the crowd size at which each station tips over, and what each plan does to the next station and to the road. "
        "Train frequency comes from RTA’s open timetable. The demand pattern is our own model, so the next step is to calibrate it on real station entries.”"),
    H("Questions we expect"),
    table(["They ask", "We answer"], [
        ["Is the data real?", f"The timetable is RTA’s open data. The demand is synthetic and labelled. We checked real weekday totals: five of six stations are {min(ratios):.2f} to {max(ratios):.2f} times busier than our model, and the stress test has a switch to apply that."],
        ["Is this an RTA system?", "No. It is a student research prototype, designed for RTA’s published AI priorities."],
        ["Can the AI make up numbers?", "No. Numbers come only from the simulator, and a separate check re-reads every figure before it is shown."],
        ["Which AI model is it?", "At the booth: rule-based agents on this laptop, no internet. A language model can be plugged in behind the same checks; we have not run one live yet."],
        ["Can someone trick it?", f"We tried {ev['redteam']['n']} attacks in English, Arabic and mixed text, across the ten categories of the OWASP list for AI agents. None succeeded."],
        ["What about the roads?", "The stress test shows the extra cars near the venue. It is an estimate with no traffic counts in it, and the screen says so."],
        ["Does it keep personal data?", "No. Station totals only. The kiosk counts touches, nothing about people."],
        ["Would it work elsewhere?", "The corridor is a configuration file. A new corridor needs its stations, timetable and a map bake."],
        ["What do you need from RTA?", "Hourly station entries for past events, train loading on the Red Line, and half a day with an event planner."],
    ], [45, 125]),
    H("The close"),
    say("“If RTA shared station entries for one past event, we could show how close the twin gets, station by station. Thank you for trying it. May we give you our one-page summary?”"),
    H("If something goes wrong"),
    *bullets(["<b>The picture stutters:</b> the kiosk drops to a lighter level by itself. To force it, add <b>&amp;quality=light</b> to the address, or <b>&amp;scene=v1</b> for the simpler city.",
              "<b>The laptop fails:</b> play the two backup videos from the USB stick: <b>eventflow_kiosk_show.mp4</b> and <b>eventflow_backup_demo.mp4</b>.",
              "<b>A hard question:</b> “We have not measured that. Here is what we did measure.” Then show the tool calls or the test numbers.",
              "<b>Who does what:</b> two of us are always at the stand. One drives the conversation, one watches the screen and resets it with “Start again”."]),
    H("Words to use and words to avoid"),
    table(["Use", "Avoid"], [
        ["Designed for RTA’s priorities", "Used by RTA, approved by RTA, RTA’s system"],
        ["Research prototype", "Product, solution ready to deploy"],
        ["Synthetic demand, labelled", "Real ridership, real crowds"],
        ["The simulator measures; a person approves", "The AI decides"],
        ["Estimate, assumption", "Prediction, guarantee"],
    ], [85, 85], bold_first=False),
]
build("EventFlow_Twin_Script_for_RTA.pdf", "EventFlow Twin: what we say to RTA", rta)

# ============================================================== 2. the script for the professor
prof = [
    P("EventFlow Twin: what we say to Dr. Rachit", "title"),
    P("Talk script and decisions needed. From Krishna Mathur, Atharva Soundankar and Yash Petkar, MAIB September 2025 batch.", "sub"),
    H("The three-minute update (say this)"),
    say("“Sir, the prototype is working end to end and it is live. A visitor picks an event, sees which metro station gets crowded, asks the AI for a plan, and approves it. "
        "Since the nomination we sent you on 12 November, we have made the AI planner check its own work and try again when a plan is not good enough, "
        "rebuilt the 3D city so that people recognise Dubai, and tested it much harder. "
        "We want to show you the two-minute demo, tell you plainly what is real and what is assumed, and ask you for four decisions.”"),
    H("What is new since the nomination of 12 November"),
    *bullets([
        "<b>The planner checks itself.</b> A critic checks whether a plan clears every station. If none does, the planner tries again, at most twice. Every step is shown on screen.",
        "<b>A recognisable city.</b> Open-data buildings, a satellite ground, and our own models of the Burj Khalifa, Emirates Towers, the Museum of the Future, the Trade Centre tower and Dubai Frame. Visitors can touch a landmark and the camera turns round it.",
        "<b>A visitor kiosk.</b> Two ways in (planner or rider), a stress test, a 60-second guided show, Arabic and English, and controls that can be brought down for a seated visitor.",
        "<b>A road figure.</b> The stress test shows the extra cars near the venue. It is an estimate and is labelled.",
        f"<b>A check against real data.</b> Real weekday entries are {min(ratios):.2f} to {max(ratios):.2f} times our model at five of six stations. A switch applies those real totals.",
        "<b>Nomination v3.</b> Same text with the new screenshots and the updated test figures. It is attached for you to forward if you agree.",
    ]),
    H("The numbers, and where each comes from"),
    table(["Measure", "Result", "Source"], [
        ["Plan options with every number traced to the simulator", f"{ev['agents']['metrics']['options_checked']} of {ev['agents']['metrics']['options_checked']}, over {ev['agents']['n']} scenarios", ev["agents"]["file"]],
        ["Attack cases that succeeded", f"0 of {ev['redteam']['n']} (ten OWASP categories for AI agents)", ev["redteam"]["file"]],
        ["Simulator property checks", f"{ev['simulator']['n']} of {ev['simulator']['n']} pass", ev["simulator"]["file"]],
        ["Forecast error against the seasonal baseline", f"{ev['forecast']['metrics']['lgbm_mase']:.2f} against {ev['forecast']['metrics']['naive_mase']:.2f} (lower is better; synthetic data)", ev["forecast"]["file"]],
        ["Slowest plan wait under load", f"{ev['latency']['metrics']['p95_seconds']:.1f} s at the 95th percentile, {ev['latency']['metrics']['errors']} errors in {ev['latency']['metrics']['requests']} requests", ev["latency"]["file"]],
        ["Automated tests", "177 for the engine, 39 in the browser", "test runs of 13 November"],
        ["GITEX day 1, hot day, World Trade Centre", f"{pct(hot['peak'])} of comfortable capacity; {pct(hot['top']['peak'])} with the top plan", f"simulator run {hot['run_id']}"],
    ], [64, 62, 44], bold_first=False),
    H("What is real, what is assumed, what is not done"),
    table(["Real", "Assumed and labelled", "Not done yet"], [[
        "Train frequency from RTA’s open timetable. Station positions. Building footprints.",
        "The hourly demand pattern. Event attendance. The share of visitors who take the metro. The road figure. The landmark shapes.",
        "No real language model has run through the planner. No calibration on real hourly ridership. No trial with an RTA planner.",
    ]], [52, 62, 56], bold_first=False),
    H("Four decisions we need from you"),
    table(["Decision", "Why it matters", "Our suggestion"], [
        ["1  Are you the faculty lead on the form?", "The nomination names you as “to confirm”.", "Yes, if you agree."],
        ["2  May the demo link be public?", "It is live at eventflow-twin.vercel.app but we have shared it with nobody.", "Yes: it carries the “research prototype, synthetic demand” notice on every page."],
        ["3  May we print a QR code to it on the poster?", "The poster goes to print after your answer.", "Yes, if decision 2 is yes."],
        ["4  Should the code repository be private?", "It is public today.", "Your call. The demo keeps working either way."],
    ], [52, 60, 58]),
    Spacer(1, 4),
    P("We also ask you to <b>forward nomination v3 to RTA</b> if you are satisfied with it. We will not send anything to RTA ourselves."),
    H("What could go wrong, and our cover"),
    table(["Risk", "Cover"], [
        ["No Wi-Fi at the venue", "The whole demo runs on the laptop with no internet."],
        ["The booth laptop is too slow for the full picture", "The kiosk drops to a lighter level by itself. Two backup videos are on a USB stick."],
        ["An expert asks which AI model it is", "We say it plainly: rule-based at the booth; a language model fits behind the same checks but has not been run live."],
        ["The Arabic has mistakes", "It is marked as a draft until a native speaker has reviewed it. That review is still open."],
        ["The touch monitor behaves differently", "Not yet tested on the real monitor. This is on our list before Monday."],
    ], [62, 108], bold_first=False),
    H("Dates"),
    *bullets(["<b>Monday 16 November, noon:</b> we stop changing the build.", "<b>18–21 November:</b> Emirates Towers.", "<b>23–25 November:</b> RTA Head Office."]),
    H("Attached with this note"),
    *bullets(["Nomination v3 (PDF)", "Pitch deck for RTA (PowerPoint, 12 slides)", "Booth script for RTA (PDF)", "Two backup videos (MP4): the kiosk show and the full workspace demo"]),
]
build("EventFlow_Twin_Script_for_Dr_Rachit.pdf", "EventFlow Twin: what we say to Dr. Rachit", prof)
