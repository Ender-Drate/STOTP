"use client";

import { useState } from "react";

export interface CaptchaPoint {
  x: number;
  y: number;
}

export function ShapeCaptcha({
  image, point, onPick,
}: {
  image: string;
  point: CaptchaPoint | null;
  onPick: (point: CaptchaPoint) => void;
}) {
  const [natural, setNatural] = useState({ width: 420, height: 344 });

  function pick(event: React.MouseEvent<HTMLImageElement>) {
    const imageEl = event.currentTarget;
    const rect = imageEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.round(
      (event.clientX - rect.left) * (imageEl.naturalWidth / rect.width),
    );
    const y = Math.round(
      (event.clientY - rect.top) * (imageEl.naturalHeight / rect.height),
    );
    onPick({ x, y });
  }

  return (
    <div className="captcha-pick">
      <div className="captcha-canvas">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt="图形验证码"
          width={natural.width}
          height={natural.height}
          onClick={pick}
          onLoad={(event) => {
            const imageEl = event.currentTarget;
            setNatural({
              width: imageEl.naturalWidth || 420,
              height: imageEl.naturalHeight || 344,
            });
          }}
        />
        {point ? (
          <span
            className="captcha-pin"
            style={{
              left: `${(point.x / natural.width) * 100}%`,
              top: `${(point.y / natural.height) * 100}%`,
            }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );
}
