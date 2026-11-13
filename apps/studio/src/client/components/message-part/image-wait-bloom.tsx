import { useEffect, useRef, useState } from "react";

/**
 * What the image box shows while a picture is being made and no frame of it has
 * arrived: a grid of faint dots that open into pluses in uneven patches, each
 * patch on its own beat. One WebGL fragment shader draws every pixel, so the
 * page does no layout or paint work per frame.
 *
 * It draws only while the box is on screen, holds a single still frame under
 * reduced motion, and leaves the box blank (`fallback`) where WebGL is missing.
 */
export function ImageWaitBloom({ fallback }: { fallback: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
    });
    const program = gl ? compile(gl) : null;
    if (!gl || !program) {
      setUnavailable(true);
      return;
    }

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    // One triangle that covers the whole viewport.
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const size = gl.getUniformLocation(program, "R");
    const time = gl.getUniformLocation(program, "T");
    const pixelRatio = gl.getUniformLocation(program, "DPR");
    const ink = gl.getUniformLocation(program, "INK");
    gl.uniform3fv(
      ink,
      document.documentElement.classList.contains("dark") ? INK_DARK : INK,
    );

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let visible = false;
    // Starts partway into the loop so the first frame already has open patches.
    let clock = START_SECONDS;
    let last = performance.now();

    const draw = (now: number) => {
      clock += (now - last) / 1000;
      last = now;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.uniform2f(size, width, height);
      gl.uniform1f(time, clock);
      gl.uniform1f(pixelRatio, ratio);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      frame = visible && !still ? requestAnimationFrame(draw) : 0;
    };

    // A box scrolled away, or in a tab that is not showing, stops drawing.
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible && frame === 0) {
        last = performance.now();
        frame = requestAnimationFrame(draw);
      }
    });
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      // Browsers cap live WebGL contexts, so give this one back now rather than
      // whenever the canvas is collected.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  if (unavailable) {
    return fallback;
  }
  return <canvas aria-hidden className="block size-full" ref={canvasRef} />;
}

const START_SECONDS = 4;

/** `--brand-500` and `--brand-400`, as 0 to 1 sRGB channels. */
const INK = [0x0e / 255, 0x78 / 255, 0x69 / 255];
const INK_DARK = [0x33 / 255, 0x8c / 255, 0x81 / 255];

const VERTEX =
  "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";

/** The tuned values are constants here; each names what it changes. */
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 R;
uniform float T;
uniform float DPR;
uniform vec3 INK;
const float PI = 3.14159265;

const float SPEED = 0.85;   // how fast each patch swells and fades
const float MORPH = 0.23;   // how fast patch outlines reshape, as a share of the beat
const float SHARP = 1.8;    // higher makes each swell a quick flash with a longer rest
const float PITCH = 7.0;    // distance between marks, in CSS pixels
const float SIZE = 187.0;   // how big the swelling patches are
const float ARM = 0.8;      // arm length of a fully open plus
const float MIN_ARM = 0.1;  // arm length at rest
const float WIDTH = 0.4;    // thickness of the plus arms
const float SPREAD = 0.97;  // how out of step neighboring patches are
const float WISP = 1.1;     // frays patch edges into wisps
const float BEAT = 0.92;    // how much the beat opens the marks
const float SHAPE = 1.31;   // how much the slow patch outlines open the marks
const float TURN = 20.0;    // degrees a plus turns as it opens
const float REVERSE = 1.0;  // how far the waves turn toward rolling the other way
const float VARY = 1.0;     // drift in tempo, strength, timing and spin
const float LO = 0.23;      // where marks start to open
const float HI = 0.78;      // where marks are fully open
const float AMIN = 0.12;    // opacity of a resting mark
const float AMAX = 0.8;     // opacity of a fully open mark

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float seg(vec2 p, float h, float w) { vec2 q = vec2(max(abs(p.x) - h, 0.0), p.y); return 1.0 - smoothstep(w - 0.6, w + 0.6, length(q)); }
float plus(vec2 p, float h, float w) { return max(seg(p, h, w), seg(p.yx, h, w)); }
// Centered on zero, so turning between two of these keeps the same amount of offset.
float beatPhase(vec2 u) { return (noise(u * 0.75) - 0.5) * 6.28 * SPREAD + (fbm(u * 2.4) - 0.47) * WISP; }

void main() {
  vec2 px = gl_FragCoord.xy / DPR;
  px.y = R.y - px.y;
  // A grid that runs half a cell past every edge.
  vec2 g = (px + PITCH * 0.5) / PITCH;
  vec2 f = (fract(g) - 0.5) * PITCH;
  vec2 u = floor(g) * PITCH / SIZE;
  float tt = T * SPEED;
  float shape = mix(fbm(u + vec2(0.0, 1.7)), fbm(u + vec2(7.3, 4.1)), 0.5 + 0.5 * sin(tt * MORPH));
  // Who beats when blends two independent offset maps, A cos(th) + B sin(th), so
  // the waves slowly turn around without the box ever pulsing all at once.
  float clock = tt + VARY * 1.2 * sin(tt * 0.21 + 1.3);
  float th = PI * 0.5 * (1.0 - cos(tt * 0.06)) * REVERSE + VARY * 0.7 * sin(tt * 0.083 + 0.6);
  float ph = beatPhase(u) * cos(th) + beatPhase(u + vec2(13.7, 4.2)) * sin(th);
  float beat = pow(0.5 + 0.5 * sin(clock - ph), SHARP);
  beat *= mix(1.0, 0.55 + 0.45 * (0.5 + 0.5 * sin(tt * 0.31 + noise(u * 0.4 + 5.0) * 6.28)), VARY);
  float s = smoothstep(LO, max(HI, LO + 0.001), shape * SHAPE + beat * BEAT);
  // Some regions turn clockwise and some counterclockwise.
  float spin = mix(1.0, clamp((noise(u * 0.6 + 9.1) - 0.5) * 6.0, -1.0, 1.0), VARY);
  vec2 q = rot(s * TURN * spin * PI / 180.0) * f;
  float a = clamp(plus(q, mix(MIN_ARM, ARM, s), WIDTH) * mix(AMIN, AMAX, s), 0.0, 1.0);
  gl_FragColor = vec4(INK * a, a);
}`;

function compile(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) {
      return null;
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      return null;
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}
