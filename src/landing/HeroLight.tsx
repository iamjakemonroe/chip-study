import { useEffect, useRef } from 'react';

/** Daylight through silk: soft pastel ribbons drifting across paper-white, behind the hero. One
 * small shader at half the screen's pixels (it's all soft light, so it looks the same), drawn only
 * while it's on screen and the tab is visible, leaning a little towards the pointer. With reduced
 * motion it's one still frame. */
const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = r * p * 2.02 + 0.13; a *= 0.5; }
  return v;
}
// How strongly a ribbon of light covers this point.
float ribbon(vec2 p, float t, float seed, float height, float freq, float width) {
  float n = fbm(vec2(p.x * 0.9 + t * 0.7 + seed, t * 0.35 + seed * 1.7));
  float y = height + sin(p.x * freq + t * 1.3 + seed * 2.9) * 0.12 + (n - 0.5) * 0.55;
  float d = p.y - y;
  float core = exp(-d * d / width);
  // Fine silk threads along the ribbon.
  float threads = 0.65 + 0.35 * sin((p.x * 3.0 + d * 26.0) + n * 6.0 + t * 2.0);
  return core * threads;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime * 0.05;
  p += uMouse * 0.03;
  vec3 col = vec3(0.972, 0.972, 0.988);
  vec3 lilac = vec3(0.80, 0.76, 1.00);
  vec3 sky = vec3(0.70, 0.86, 1.00);
  vec3 mint = vec3(0.74, 0.95, 0.88);
  vec3 peach = vec3(1.00, 0.84, 0.76);
  col = mix(col, lilac, 0.78 * ribbon(p, t, 0.0, 0.22, 1.6, 0.020));
  col = mix(col, sky, 0.70 * ribbon(p, t, 3.1, 0.02, 1.2, 0.028));
  col = mix(col, mint, 0.55 * ribbon(p, t, 6.7, -0.20, 1.9, 0.018));
  col = mix(col, peach, 0.45 * ribbon(p, t, 9.2, 0.38, 1.4, 0.012));
  // A soft sheen where ribbons cross.
  col += vec3(0.02, 0.015, 0.03) * fbm(p * 2.0 + t);
  // Paper in the middle, where the words are.
  float centre = smoothstep(0.75, 0.0, length((p - vec2(0.0, 0.08)) * vec2(0.7, 1.6)));
  col = mix(col, vec3(0.976, 0.976, 0.992), centre * 0.55);
  // Grain, so the gradients never band.
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) * 0.012;
  gl_FragColor = vec4(col, 1.0);
}`;

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

export function HeroLight({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) return;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, 'uRes');
    const uTime = gl.getUniformLocation(program, 'uTime');
    const uMouse = gl.getUniformLocation(program, 'uMouse');

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.ty = -(e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let visible = true;
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    seen.observe(canvas);

    const start = performance.now() - 30_000;
    let frame = 0;
    const draw = (now: number) => {
      mouse.x += (mouse.tx - mouse.x) * 0.05;
      mouse.y += (mouse.ty - mouse.y) * 0.05;
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (visible && !document.hidden) draw(now);
    };
    if (reduce) draw(performance.now());
    else frame = requestAnimationFrame(loop);
    canvas.classList.add('is-ready');

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      seen.disconnect();
      window.removeEventListener('pointermove', onMove);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
