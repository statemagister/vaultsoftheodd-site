#!/usr/bin/env python3
"""Print PDF for a Ravenloft I6 Playability Guide Part, built from its approved
Markdown file (the same file the web page is built from).

    python3 tools/playability-pdf/mkpdf.py SOURCE.md OUT.pdf

Needs reportlab, markdown-it-py and the DejaVu fonts (Serif, Serif-Bold and Sans-Bold from the
system's fonts-dejavu; Serif-Italic and Serif-BoldItalic, which Debian splits
into another package, are found in matplotlib's bundled fonts if not installed).
Rebuilt on 21 Nov 2026 to reproduce the layout of the October PDFs: A4, DejaVu,
running header from page 2, centred page numbers, closing note on the last page.

The source's own title line ("# Ravenloft I6 Playability Guide, Part IV") gives
the title and part; its byline line is replaced by the site byline; a closing
"---" plus "*Last updated ...*" becomes the closing note. Everything else is
rendered as written: no typographic substitution, so quotes stay straight.
"""
import glob
import os
import re
import sys

from markdown_it import MarkdownIt
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.fonts import addMapping
from reportlab.platypus import (CondPageBreak, Flowable, HRFlowable, KeepTogether, ListFlowable,
                                ListItem, Paragraph, SimpleDocTemplate, Spacer,
                                Table, TableStyle)

INK = colors.HexColor('#2c2420')
GOLD = colors.HexColor('#8b7355')
MUTED = colors.HexColor('#5a4e44')
RULE = colors.HexColor('#d4c9b8')
SHADE = colors.HexColor('#f5f1ea')


def find_font(name):
    for pattern in ('/usr/share/fonts/truetype/dejavu/%s',
                    '/usr/share/fonts/**/%s',
                    os.path.expanduser('~/.local/lib/python3*/site-packages/matplotlib/mpl-data/fonts/ttf/%s'),
                    '/usr/lib/python3*/**/matplotlib/mpl-data/fonts/ttf/%s',
                    '/usr/local/lib/python3*/**/matplotlib/mpl-data/fonts/ttf/%s'):
        hits = glob.glob(pattern % name, recursive=True)
        if hits:
            return hits[0]
    sys.exit('font not found: %s' % name)


for face in ('DejaVuSerif', 'DejaVuSerif-Bold', 'DejaVuSerif-Italic',
             'DejaVuSerif-BoldItalic', 'DejaVuSans-Bold'):
    pdfmetrics.registerFont(TTFont(face, find_font(face + '.ttf')))
addMapping('DejaVuSerif', 0, 0, 'DejaVuSerif')
addMapping('DejaVuSerif', 1, 0, 'DejaVuSerif-Bold')
addMapping('DejaVuSerif', 0, 1, 'DejaVuSerif-Italic')
addMapping('DejaVuSerif', 1, 1, 'DejaVuSerif-BoldItalic')

BODY = ParagraphStyle('body', fontName='DejaVuSerif', fontSize=9.5, leading=13.5,
                      textColor=INK, alignment=TA_JUSTIFY, spaceAfter=8.6)
ITEM = ParagraphStyle('item', parent=BODY, spaceAfter=5.7)
NOTE = ParagraphStyle('note', parent=BODY, fontSize=8.5, leading=12, spaceAfter=6)
H2 = ParagraphStyle('h2', fontName='DejaVuSans-Bold', fontSize=13, leading=16,
                    textColor=INK, spaceBefore=18, spaceAfter=2, alignment=TA_LEFT)
H3 = ParagraphStyle('h3', fontName='DejaVuSans-Bold', fontSize=10.5, leading=13,
                    textColor=GOLD, spaceBefore=14, spaceAfter=6, alignment=TA_LEFT)
H4 = ParagraphStyle('h4', parent=H3, fontSize=9.5, textColor=INK, spaceBefore=10, spaceAfter=4)
TITLE = ParagraphStyle('title', fontName='DejaVuSans-Bold', fontSize=18, leading=22, textColor=INK)
PART = ParagraphStyle('part', fontName='DejaVuSans-Bold', fontSize=14, leading=18, textColor=GOLD,
                      spaceBefore=10)
BYLINE = ParagraphStyle('byline', fontName='DejaVuSerif-Italic', fontSize=9, leading=12,
                        textColor=MUTED, spaceBefore=14, spaceAfter=14)
CELL = ParagraphStyle('cell', fontName='DejaVuSerif', fontSize=8.3, leading=10.8, textColor=INK)
HEAD = ParagraphStyle('head', fontName='DejaVuSans-Bold', fontSize=7.6, leading=10, textColor=GOLD)
CLOSE = ParagraphStyle('close', fontName='DejaVuSerif-Italic', fontSize=7.5, leading=10,
                       textColor=MUTED, alignment=TA_CENTER)


_MD = MarkdownIt('commonmark', {'html': False})  # same emphasis rules as the site's Goldmark; no typographer


def inline(text):
    """Markdown inline markup to ReportLab paragraph markup, via a CommonMark parser
    so nested emphasis (a bold sentence ending in an italic word, ***Name***) nests
    exactly as on the web page."""
    h = _MD.renderInline(text)
    h = re.sub(r'<a [^>]*>(.*?)</a>', r'\1', h)
    h = h.replace('<strong>', '<b>').replace('</strong>', '</b>')
    h = h.replace('<em>', '<i>').replace('</em>', '</i>')
    h = h.replace('&quot;', '"').replace('<code>', '').replace('</code>', '')
    return h


class Underlined(Flowable):
    """An h2 with a short gold rule beneath it, as in the October PDFs."""

    def __init__(self, text):
        super().__init__()
        self.p = Paragraph(inline(text), H2)

    def wrap(self, aw, ah):
        self.aw = aw
        w, h = self.p.wrap(aw, ah)
        self.ph = h
        return aw, h + 8

    def draw(self):
        self.p.drawOn(self.canv, 0, 8)
        self.canv.setStrokeColor(GOLD)
        self.canv.setLineWidth(0.8)
        self.canv.line(0, 2, self.aw * 0.4, 2)

    def getSpaceBefore(self):
        return H2.spaceBefore

    def getSpaceAfter(self):
        return 12


PAD = 5  # cell padding, left and right


def text_width(markup, style):
    """Width of a cell's text on one line; bold runs are measured in bold."""
    plain = re.sub(r'<[^>]+>', '', markup)
    bold_chars = sum(len(m) for m in re.findall(r'<b>(.*?)</b>', markup))
    w = pdfmetrics.stringWidth(plain, style.fontName, style.fontSize)
    return w * (1 + 0.08 * bold_chars / max(len(plain), 1))


def word_width(markup, style):
    plain = re.sub(r'<[^>]+>', '', markup)
    return max([pdfmetrics.stringWidth(x, style.fontName, style.fontSize) * 1.08 for x in plain.split()] or [0])


def table(rows, width, scale=1.0):
    """A Markdown pipe table as a ReportLab Table, laid out the way a browser lays
    out an automatic-width table: every column gets at least its longest word,
    columns that fit on one line get their full width, and the rest of the width
    goes to the columns with the most text. Columns of short values (all cells of
    ten characters or fewer: numbers, dice, card values, page references) are kept
    on one line and centred. An all-empty header row is left out."""
    cells = [[c.strip() for c in r.strip().strip('|').split('|')] for r in rows]
    header, body = cells[0], cells[2:]
    ncol = len(header)
    body = [(r + [''] * ncol)[:ncol] for r in body]
    has_head = any(h for h in header)
    plain = lambda s: re.sub(r'[*`]', '', s)
    short = [all(len(plain(r[c])) <= 10 for r in body) and len(plain(header[c])) <= 14 and any(r[c] for r in body)
             for c in range(ncol)]
    blank = [not any(r[c] for r in body) for c in range(ncol)]
    head = ParagraphStyle('hd', parent=HEAD, fontSize=HEAD.fontSize * scale, leading=HEAD.leading * scale)
    cell = ParagraphStyle('cl', parent=CELL, fontSize=CELL.fontSize * scale, leading=CELL.leading * scale)
    head_style = [ParagraphStyle('h%d' % c, parent=head, alignment=TA_CENTER if short[c] else TA_LEFT) for c in range(ncol)]
    cell_style = [ParagraphStyle('c%d' % c, parent=cell, alignment=TA_CENTER if short[c] else TA_LEFT) for c in range(ncol)]
    data = []
    if has_head:
        data.append([Paragraph(inline(h), head_style[c]) for c, h in enumerate(header)])
    data += [[Paragraph(inline(x), cell_style[c]) for c, x in enumerate(r)] for r in body]

    mins, maxs = [], []
    for c in range(ncol):
        texts = [(inline(header[c]), head)] if has_head else []
        texts += [(inline(r[c]), cell) for r in body]
        mx = max(text_width(x, s) for x, s in texts) + 2 * PAD + 2
        mn = max(word_width(x, s) for x, s in texts) + 2 * PAD + 2
        if blank[c]:            # a column left for the DM to write in
            mn, mx = max(mn, 70), max(mx, 140)
        if short[c]:            # keep on one line
            mn = mx
        mins.append(mn)
        maxs.append(mx)
    if sum(mins) > width and scale > 0.76:
        # Too many columns for the page at this size (the ten-column Intelligence
        # table): set the whole table smaller rather than break short values.
        return table(rows, width, scale * max(0.76, width / sum(mins) * 0.99))
    if all(short) and sum(maxs) <= width:
        # A table of short values only: compact, not stretched across the page.
        widths = [m + 14 for m in maxs]
        if sum(widths) > width:
            widths = [w * width / sum(widths) for w in widths]
    elif sum(maxs) <= width:
        # Everything fits on one line: share the spare width out by content.
        extra = width - sum(maxs)
        grow = [0 if short[c] else maxs[c] for c in range(ncol)]
        tot = sum(grow) or sum(maxs)
        grow = grow if sum(grow) else maxs
        widths = [maxs[c] + extra * grow[c] / tot for c in range(ncol)]
    else:
        spare = width - sum(mins)
        # A cell's one-line width is capped at the table width, so one column of
        # long prose cannot starve the others.
        give = [min(maxs[c], width) - mins[c] for c in range(ncol)]
        tot = sum(give) or 1
        widths = [mins[c] + max(spare, 0) * give[c] / tot for c in range(ncol)]
        if spare < 0:  # longest words alone overflow: scale down
            widths = [w * width / sum(widths) for w in widths]

    # A row taller than about half a page must be allowed to break across pages.
    # ReportLab then repeats the header at the break even mid-page, so such tables
    # do not repeat their header; the rest do.
    tall = any(p.wrap(widths[c] - 2 * PAD, 10000)[1] > 330 for row in data for c, p in enumerate(row))
    t = Table(data, colWidths=widths, repeatRows=1 if has_head and not tall else 0,
              hAlign='LEFT', splitInRow=1 if tall else 0)
    style = [('GRID', (0, 0), (-1, -1), 0.4, RULE), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
             ('LEFTPADDING', (0, 0), (-1, -1), PAD), ('RIGHTPADDING', (0, 0), (-1, -1), PAD),
             ('TOPPADDING', (0, 0), (-1, -1), 3.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 4.5)]
    if has_head:
        style += [('LINEBELOW', (0, 0), (-1, 0), 0.8, GOLD), ('BACKGROUND', (0, 0), (-1, 0), SHADE),
                  ('VALIGN', (0, 0), (-1, 0), 'MIDDLE'), ('TOPPADDING', (0, 0), (-1, 0), 4.5)]
    t.setStyle(TableStyle(style))
    return t


def blocks(md):
    lines = md.split('\n')
    i, out = 0, []
    while i < len(lines):
        l = lines[i]
        if not l.strip():
            i += 1
        elif l.startswith('#'):
            lvl = len(l) - len(l.lstrip('#'))
            out.append(('h%d' % lvl, l[lvl:].strip()))
            i += 1
        elif l.strip() == '---':
            out.append(('hr', None))
            i += 1
        elif l.startswith('>'):
            paras, cur = [], []
            while i < len(lines) and lines[i].startswith('>'):
                s = lines[i][1:].strip()
                if s:
                    cur.append(s)
                elif cur:
                    paras.append(' '.join(cur))
                    cur = []
                i += 1
            if cur:
                paras.append(' '.join(cur))
            out.append(('quote', paras))
        elif l.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append(lines[i])
                i += 1
            out.append(('table', rows))
        elif re.match(r'^\s*([-*]|\d+\.)\s', l):
            ordered = bool(re.match(r'^\s*\d+\.', l))
            items = []
            while i < len(lines) and lines[i].strip():
                m = re.match(r'^\s*([-*]|\d+\.)\s+(.*)', lines[i])
                if m:
                    items.append(m.group(2))
                else:
                    items[-1] += ' ' + lines[i].strip()
                i += 1
            out.append(('ol' if ordered else 'ul', items))
        else:
            para = []
            while i < len(lines) and lines[i].strip() and not re.match(r'^(#|>|\||---$|\s*([-*]|\d+\.)\s)', lines[i]):
                para.append(lines[i].strip())
                i += 1
            out.append(('p', ' '.join(para)))
    return out


def build(src, out):
    md = open(src, encoding='utf-8').read()
    lines = md.split('\n')
    m = re.match(r'^# (Ravenloft I6 Playability Guide), (Part [IVXL]+)$', lines[0])
    if not m or not lines[2].startswith('By Drew Griffiths'):
        sys.exit('unexpected header in %s' % src)
    series, part = m.groups()
    bl = blocks('\n'.join(lines[3:]))
    updated = None
    if len(bl) >= 2 and bl[-2][0] == 'hr' and bl[-1][0] == 'p' and re.fullmatch(r'\*Last updated [^*]+\.\*', bl[-1][1]):
        updated = bl[-1][1].strip('*')
        bl = bl[:-2]

    story = [Paragraph(series, TITLE), Paragraph(part, PART),
             Paragraph('By Drew Griffiths &middot; vaultsoftheodd.com', BYLINE)]
    for kind, val in bl:
        if kind == 'h2':
            story.append(Underlined(val))
        elif kind == 'h3':
            story.append(Paragraph(inline(val), H3))
        elif kind in ('h4', 'h5', 'h6'):
            story.append(Paragraph(inline(val), H4))
        elif kind == 'p':
            story.append(Paragraph(inline(val), BODY))
        elif kind == 'hr':
            story.append(HRFlowable(width='100%', thickness=0.5, color=RULE, spaceBefore=6, spaceAfter=14))
        elif kind == 'quote':
            inner = [Paragraph(inline(p), NOTE) for p in val]
            t = Table([[inner]], colWidths=['100%'])
            t.setStyle(TableStyle([
                ('LINEABOVE', (0, 0), (-1, 0), 0.6, RULE), ('LINEBELOW', (0, -1), (-1, -1), 0.6, RULE),
                ('LEFTPADDING', (0, 0), (-1, -1), 11), ('RIGHTPADDING', (0, 0), (-1, -1), 11),
                ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
            story += [Spacer(1, 4), t, Spacer(1, 10)]
        elif kind in ('ul', 'ol'):
            items = [ListItem(Paragraph(inline(x), ITEM), leftIndent=28.3) for x in val]
            story.append(ListFlowable(
                items, bulletType='1' if kind == 'ol' else 'bullet', start='1' if kind == 'ol' else None,
                bulletFontName='DejaVuSerif', bulletFontSize=9.25 if kind == 'ul' else 9.5,
                bulletColor=INK, leftIndent=28.3, bulletDedent=28.3 if kind == 'ul' else 17,
                bulletFormat='%s.' if kind == 'ol' else None, spaceBefore=0, spaceAfter=8.6))
        elif kind == 'table':
            story.append(('TABLE', val))

    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=25 * mm, rightMargin=25 * mm,
                            topMargin=20 * mm, bottomMargin=25 * mm,
                            title='%s, %s' % (series, part), author='Drew Griffiths',
                            subject='I6 Ravenloft playability guide for DMs')
    width = doc.width - 12  # the frame keeps 6pt padding each side
    final = []
    for f in story:
        if isinstance(f, tuple):
            tb = table(f[1], width)
            h = tb.wrap(width, 10000)[1]
            if h < 0.6 * doc.height:
                # Short enough to keep whole: never start it at a page foot, and keep
                # an introducing line ("The location sheet:") with it.
                lead = []
                if final and isinstance(final[-1], Paragraph) and final[-1].text.rstrip().endswith(':'):
                    lead = [final.pop()]
                final += [Spacer(1, 2), KeepTogether(lead + [tb]), Spacer(1, 11)]
            else:
                # A long table that will run over pages: start it on a new page
                # rather than with a row or two at the foot of this one.
                final += [CondPageBreak(0.3 * doc.height), Spacer(1, 2), tb, Spacer(1, 11)]
        else:
            final.append(f)
    # Keep each heading with what follows it.
    kept = []
    for f in final:
        if kept and isinstance(kept[-1], (Underlined,)) or (kept and isinstance(kept[-1], Paragraph) and kept[-1].style.name in ('h3', 'h4')):
            prev = kept.pop()
            kept.append(KeepTogether([prev, f]))
        else:
            kept.append(f)
    if updated:
        note = ('This document is a printable companion to the web version at vaultsoftheodd.com. '
                'Formatted for A4 and intended for table reference during play.<br/>%s.' % updated.rstrip('.'))
        kept += [Spacer(1, 16), HRFlowable(width='100%', thickness=0.5, color=RULE, spaceAfter=8),
                 Paragraph(note, CLOSE)]

    def page(canv, d):
        canv.saveState()
        pw, ph = A4
        if d.page > 1:
            canv.setFont('DejaVuSerif-Italic', 7)
            canv.setFillColor(MUTED)
            canv.drawString(25 * mm, ph - 46, series)
            canv.drawRightString(pw - 25 * mm, ph - 46, 'vaultsoftheodd.com')
            canv.setStrokeColor(RULE)
            canv.setLineWidth(0.5)
            canv.line(25 * mm, ph - 51, pw - 25 * mm, ph - 51)
        canv.setFont('DejaVuSerif', 7.5)
        canv.setFillColor(MUTED)
        canv.drawCentredString(pw / 2, 42, str(d.page))
        canv.restoreState()

    doc.build(kept, onFirstPage=page, onLaterPages=page)


if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2])
