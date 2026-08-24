// Adapted from React Bits Balatro by David Haz.
// Copyright (c) 2026 David Haz. Licensed under the MIT + Commons Clause
// License Condition v1.0 for use as part of this application.
// Source: https://reactbits.dev/backgrounds/balatro

import { Mesh, Program, Renderer, Triangle } from "ogl";
import { useEffect, useRef } from "react";

interface BalatroTransitionProps {
  readonly className?: string;
  readonly color1?: string;
  readonly color2?: string;
  readonly color3?: string;
}

const VERTEX_SHADER = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform float iTime;
uniform vec3 iResolution;
uniform float uSpinRotation;
uniform float uSpinSpeed;
uniform vec2 uOffset;
uniform vec4 uColor1;
uniform vec4 uColor2;
uniform vec4 uColor3;
uniform float uContrast;
uniform float uLighting;
uniform float uSpinAmount;
uniform float uPixelFilter;
uniform float uSpinEase;
varying vec2 vUv;

vec4 effect(vec2 screenSize, vec2 screenCoords) {
  float pixelSize = length(screenSize.xy) / uPixelFilter;
  vec2 uv = (
    floor(screenCoords.xy / pixelSize) * pixelSize - 0.5 * screenSize.xy
  ) / length(screenSize.xy) - uOffset;
  float uvLength = length(uv);

  float speed = iTime * uSpinRotation * uSpinEase * 0.2 + 302.2;
  float pixelAngle = atan(uv.y, uv.x) + speed -
    uSpinEase * 20.0 * (uSpinAmount * uvLength + (1.0 - uSpinAmount));
  vec2 mid = (screenSize.xy / length(screenSize.xy)) / 2.0;
  uv = vec2(
    uvLength * cos(pixelAngle) + mid.x,
    uvLength * sin(pixelAngle) + mid.y
  ) - mid;

  uv *= 30.0;
  speed = iTime * uSpinSpeed;
  vec2 uv2 = vec2(uv.x + uv.y);

  for (int i = 0; i < 5; i++) {
    uv2 += sin(max(uv.x, uv.y)) + uv;
    uv += 0.5 * vec2(
      cos(5.1123314 + 0.353 * uv2.y + speed * 0.131121),
      sin(uv2.x - 0.113 * speed)
    );
    uv -= cos(uv.x + uv.y) - sin(uv.x * 0.711 - uv.y);
  }

  float contrastMod = 0.25 * uContrast + 0.5 * uSpinAmount + 1.2;
  float paint = min(2.0, max(0.0, length(uv) * 0.035 * contrastMod));
  float color1Part = max(0.0, 1.0 - contrastMod * abs(1.0 - paint));
  float color2Part = max(0.0, 1.0 - contrastMod * abs(paint));
  float color3Part = 1.0 - min(1.0, color1Part + color2Part);
  float light = (uLighting - 0.2) * max(color1Part * 5.0 - 4.0, 0.0) +
    uLighting * max(color2Part * 5.0 - 4.0, 0.0);

  return (0.3 / uContrast) * uColor1 +
    (1.0 - 0.3 / uContrast) * (
      uColor1 * color1Part +
      uColor2 * color2Part +
      vec4(color3Part * uColor3.rgb, color3Part * uColor1.a)
    ) + light;
}

void main() {
  gl_FragColor = effect(iResolution.xy, vUv * iResolution.xy);
}
`;

function hexToVec4(hex: string): [number, number, number, number] {
  const value = hex.replace("#", "");
  const alpha =
    value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) : 255;
  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
    alpha / 255,
  ];
}

export function BalatroTransition({
  className = "",
  color1 = "#071013",
  color2 = "#d9bf78",
  color3 = "#215a55",
}: BalatroTransitionProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new Renderer({
      alpha: false,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio || 1, 1.5),
    });
    const gl = renderer.gl;
    gl.clearColor(0.027, 0.063, 0.075, 1);
    gl.canvas.style.display = "block";
    gl.canvas.style.width = "100%";
    gl.canvas.style.height = "100%";

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: VERTEX_SHADER,
      fragment: FRAGMENT_SHADER,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: [1, 1, 1] },
        uSpinRotation: { value: -2.1 },
        uSpinSpeed: { value: 5.4 },
        uOffset: { value: [0, 0] },
        uColor1: { value: hexToVec4(color1) },
        uColor2: { value: hexToVec4(color2) },
        uColor3: { value: hexToVec4(color3) },
        uContrast: { value: 3.8 },
        uLighting: { value: 0.46 },
        uSpinAmount: { value: 0.32 },
        uPixelFilter: { value: 900 },
        uSpinEase: { value: 1.05 },
      },
    });
    const mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height);
      program.uniforms.iResolution.value = [
        gl.canvas.width,
        gl.canvas.height,
        gl.canvas.width / gl.canvas.height,
      ];
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();
    container.appendChild(gl.canvas);

    let animationFrame = 0;
    const startedAt = performance.now();
    const render = (now: number) => {
      program.uniforms.iTime.value = (now - startedAt) * 0.001;
      renderer.render({ scene: mesh });
      animationFrame = requestAnimationFrame(render);
    };
    animationFrame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      gl.canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [color1, color2, color3]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`h-full w-full overflow-hidden bg-[#071013] ${className}`}
    />
  );
}
