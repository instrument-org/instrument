from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor

output = Path("work/red-blue-squares.pdf")
output.parent.mkdir(parents=True, exist_ok=True)
page_width, page_height = letter
square_size = 120
vertical_gap = 70
block_height = 2 * square_size + vertical_gap
block_bottom = (page_height - block_height) / 2
x = (page_width - square_size) / 2

pdf = canvas.Canvas(str(output), pagesize=letter, pageCompression=1)
pdf.setTitle("Centered Red and Blue Squares")
pdf.setAuthor("Instrument")
pdf.setFillColor(HexColor("#E53935"))
pdf.rect(x, block_bottom + square_size + vertical_gap, square_size, square_size, fill=1, stroke=0)
pdf.setFillColor(HexColor("#1E5BFF"))
pdf.rect(x, block_bottom, square_size, square_size, fill=1, stroke=0)
pdf.showPage()
pdf.save()
