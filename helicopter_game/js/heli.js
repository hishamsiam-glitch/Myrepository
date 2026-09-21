/* Helicopter sprite drawn with canvas paths. The sprite is always drawn
 * nose-up in screen space; `bank` and `pitch` (-1..1) tilt the body and
 * `rotor` is the blade angle in radians. */
(function (global) {
  'use strict';

  function drawBody(ctx, dark) {
    // Tail boom
    ctx.fillStyle = dark ? '#000' : '#b0341f';
    ctx.beginPath();
    ctx.moveTo(-2.5, 6);
    ctx.lineTo(2.5, 6);
    ctx.lineTo(1.5, 30);
    ctx.lineTo(-1.5, 30);
    ctx.closePath();
    ctx.fill();
    // Tail fin
    ctx.fillStyle = dark ? '#000' : '#e8e2d5';
    ctx.fillRect(-1.5, 26, 9, 3);
    // Fuselage
    ctx.fillStyle = dark ? '#000' : '#d63f26';
    ctx.beginPath();
    ctx.ellipse(0, 0, 8, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!dark) {
      ctx.fillStyle = '#f26a4b';
      ctx.beginPath();
      ctx.ellipse(-2.5, -2, 3.5, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      // Cockpit glass
      ctx.fillStyle = '#9fd7f5';
      ctx.beginPath();
      ctx.ellipse(0, -8, 5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(-1.5, -10, 1.8, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Skids
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-10, -8); ctx.lineTo(-10, 10);
      ctx.moveTo(10, -8); ctx.lineTo(10, 10);
      ctx.moveTo(-10, -3); ctx.lineTo(-6, -3);
      ctx.moveTo(-10, 6); ctx.lineTo(-6, 6);
      ctx.moveTo(10, -3); ctx.lineTo(6, -3);
      ctx.moveTo(10, 6); ctx.lineTo(6, 6);
      ctx.stroke();
      // Rotor hub
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRotor(ctx, rotor, dark) {
    // Blur disc
    ctx.fillStyle = dark ? 'rgba(0,0,0,0.12)' : 'rgba(40,40,40,0.14)';
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.rotate(rotor);
    ctx.strokeStyle = dark ? 'rgba(0,0,0,0.45)' : 'rgba(30,30,30,0.85)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-26, 0); ctx.lineTo(26, 0);
    ctx.moveTo(0, -26); ctx.lineTo(0, 26);
    ctx.stroke();
    ctx.restore();
    // Tail rotor
    ctx.save();
    ctx.translate(6, 27);
    ctx.rotate(rotor * 1.7);
    ctx.strokeStyle = dark ? 'rgba(0,0,0,0.4)' : 'rgba(30,30,30,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-5, 0); ctx.lineTo(5, 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawHelicopter(ctx, x, y, bank, pitch, rotor, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    // Banking squashes the body horizontally, pitching squashes vertically.
    ctx.transform(1 - Math.abs(bank) * 0.18, 0, bank * 0.12, 1 - Math.abs(pitch) * 0.08, 0, 0);
    ctx.rotate(bank * 0.12);
    drawBody(ctx, false);
    drawRotor(ctx, rotor, false);
    ctx.restore();
  }

  function drawShadow(ctx, x, y, rotor, scale, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    drawBody(ctx, true);
    drawRotor(ctx, rotor, true);
    ctx.restore();
  }

  global.Heli = { drawHelicopter, drawShadow };
})(typeof window !== 'undefined' ? window : globalThis);
