from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import red, blue

# Output path
OUT_PATH = "output/red-and-blue-squares.pdf"

# Page setup
page_w, page_h = letter  # 612 x 792 points
c = canvas.Canvas(OUT_PATH, pagesize=letter)

# Square sizes (points)
square_size = 200

# Positioning: centered horizontally, red above blue
x = (page_w - square_size) / 2

# Leave margins and a small gap
top_margin = 120
gap = 40

y_red = page_h - top_margin - square_size

y_blue = y_red - gap - square_size

# Draw red square
c.setFillColor(red)
c.setStrokeColor(red)
c.rect(x, y_red, square_size, square_size, fill=1, stroke=0)

# Draw blue square below
c.setFillColor(blue)
c.setStrokeColor(blue)
c.rect(x, y_blue, square_size, square_size, fill=1, stroke=0)

c.showPage()
c.save()

print(f"Wrote {OUT_PATH}")
