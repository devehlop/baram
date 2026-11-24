import sys
from PIL import Image
import numpy as np
src, dst = sys.argv[1], sys.argv[2]
box = tuple(int(x) for x in sys.argv[3].split(',')) if len(sys.argv) > 3 else None
im = Image.open(src).convert('RGB')
if box: im = im.crop(box)
a = np.asarray(im).astype(np.float32)
h, w, _ = a.shape
# фон — медиана по рамке в 6 px
edge = np.concatenate([a[:6].reshape(-1,3), a[-6:].reshape(-1,3), a[:, :6].reshape(-1,3), a[:, -6:].reshape(-1,3)])
bg = np.median(edge, axis=0)
d = np.sqrt(((a - bg) ** 2).sum(axis=2))
t0, t1 = 14.0, 46.0
alpha = np.clip((d - t0) / (t1 - t0), 0, 1)
safe = np.maximum(alpha, 1e-3)[..., None]
rgb = np.clip((a - (1 - alpha[..., None]) * bg) / safe, 0, 255)
out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
img = Image.fromarray(out, 'RGBA')
bb = img.getbbox()
if bb:
    pad = 8
    bb = (max(bb[0]-pad,0), max(bb[1]-pad,0), min(bb[2]+pad,w), min(bb[3]+pad,h))
    img = img.crop(bb)
img.save(dst)
print(dst, img.size, 'bg', bg.round())
