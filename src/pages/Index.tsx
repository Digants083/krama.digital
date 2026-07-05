import React, { useEffect, useRef } from 'react';

const KramaLandingPage: React.FC = () => {
  const heroRef = useRef<HTMLElement>(null);
  const rainCanvasRef = useRef<HTMLCanvasElement>(null);
  const journeyViewportRef = useRef<HTMLDivElement>(null);
  const journeyTrackRef = useRef<HTMLDivElement>(null);
  const journeyProgressBarRef = useRef<HTMLDivElement>(null);
  const journeyCurrentRef = useRef<HTMLSpanElement>(null);
  const journeyDotsRef = useRef<HTMLDivElement>(null);
  const featuresViewportRef = useRef<HTMLDivElement>(null);

  const css = `
    :root {
      --bg: #0E2620;
      --bg-elev: #143029;
      --text: #ffffff;
      --text-soft: #C4D8D0;
      --text-mute: rgba(255,255,255,0.5);
      --accent: #22D3EE;
      --accent-soft: rgba(34, 211, 238, 0.25);
      --accent-dim: rgba(34, 211, 238, 0.08);
      --accent-pink: #F8B4D9;
      --accent-pink-soft: rgba(248, 180, 217, 0.25);
      --accent-pink-dim: rgba(248, 180, 217, 0.08);
      --line: rgba(255,255,255,0.10);
      --line-soft: rgba(255,255,255,0.06);
      --ease-quiet: cubic-bezier(.22, 1, .36, 1);
      --ease-precise: cubic-bezier(.4, 0, .2, 1);
      --ease-emphasis: cubic-bezier(.16, 1, .3, 1);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { scroll-behavior: auto; }
    body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; font-weight: 300; line-height: 1.8; overflow-x: hidden; -webkit-font-smoothing: antialiased; }
    body.krama-landing-page .krama-ambient { overflow: visible; }
    ::selection { background: var(--accent); color: var(--bg); }
    a { color: inherit; text-decoration: none; }
    img { display: block; max-width: 100%; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg); }
    ::-webkit-scrollbar-thumb { background: var(--line); }

    /* HERO */
    .hero { min-height: 100vh; display: flex; align-items: center; position: relative; padding: 8rem 2.5rem 6rem; overflow: hidden; background: #0E2620; }
    .hero__art { position: absolute; inset: 0; z-index: 0; overflow: hidden; }
    .hero__art img { width: 100%; height: 100%; object-fit: cover; object-position: 68% center; filter: saturate(0.95) contrast(1.02); transform: scale(1.02); transition: transform 1400ms var(--ease-quiet); }
    .hero.is-in .hero__art img { transform: scale(1); }
    .hero__art::before { content: ''; position: absolute; inset: 0; z-index: 1; background: linear-gradient(90deg, rgba(14,38,32,0.96) 0%, rgba(14,38,32,0.86) 33%, rgba(14,38,32,0.48) 62%, rgba(14,38,32,0.14) 100%); pointer-events: none; }
    .hero__art::after { content: ''; position: absolute; inset: 0; z-index: 2; background: linear-gradient(180deg, rgba(14,38,32,0.12) 0%, transparent 46%, rgba(14,38,32,0.7) 100%); pointer-events: none; }
    .hero__vignette { position: absolute; inset: 0; z-index: 1; background: radial-gradient(ellipse at 18% 45%, rgba(255,255,255,0.09) 0%, transparent 48%), radial-gradient(ellipse at 78% 34%, rgba(248,180,217,0.16) 0%, transparent 38%); pointer-events: none; }
    .hero__content { position: relative; z-index: 2; max-width: 1200px; width: 100%; margin: 0 auto; }
    .hero__eyebrow { font-family: 'Fira Code', monospace; font-size: 0.72rem; letter-spacing: 0.32em; text-transform: uppercase; color: var(--accent); margin-bottom: 2.5rem; display: flex; align-items: center; gap: 1rem; opacity: 0; transform: translateY(20px); transition: opacity 800ms var(--ease-quiet), transform 800ms var(--ease-quiet); }
    .hero.is-in .hero__eyebrow { opacity: 1; transform: none; transition-delay: 200ms; }
    .hero__eyebrow::after { content: ''; display: inline-block; width: 0; height: 1px; background: var(--accent); transition: width 800ms var(--ease-quiet) 1000ms; }
    .hero.is-in .hero__eyebrow::after { width: 3rem; }
    .hero__title { font-family: 'EB Garamond', serif; font-weight: 400; font-size: clamp(2.6rem, 7.5vw, 6.2rem); line-height: 1.05; letter-spacing: -0.015em; margin-bottom: 2.5rem; max-width: 16ch; }
    .line-mask { display: block; overflow: hidden; padding-bottom: 0.1em; }
    .line { display: block; transform: translateY(110%); transition: transform 1200ms var(--ease-emphasis); }
    .hero.is-in .line { transform: translateY(0); }
    .hero.is-in .line-mask:nth-child(1) .line { transition-delay: 400ms; }
    .hero.is-in .line-mask:nth-child(2) .line { transition-delay: 550ms; }
    .hero.is-in .line-mask:nth-child(3) .line { transition-delay: 700ms; }
    .hero__title em { font-style: italic; color: var(--accent); }
    .hero__sub { font-size: 1.1rem; line-height: 1.85; color: var(--text-soft); max-width: 580px; margin-bottom: 3rem; opacity: 0; transform: translateY(20px); transition: opacity 800ms var(--ease-quiet) 1000ms, transform 800ms var(--ease-quiet) 1000ms; }
    .hero.is-in .hero__sub { opacity: 1; transform: none; }
    .hero__cta { display: flex; gap: 1.8rem; align-items: center; flex-wrap: wrap; opacity: 0; transform: translateY(16px); transition: opacity 800ms var(--ease-quiet) 1200ms, transform 800ms var(--ease-quiet) 1200ms; }
    .hero.is-in .hero__cta { opacity: 1; transform: none; }
    .btn-primary { background: var(--accent-pink); color: var(--bg); padding: 1.05rem 2rem; font-size: 0.9rem; font-weight: 500; transition: all 400ms var(--ease-quiet); display: inline-flex; align-items: center; gap: 0.8rem; border: 1px solid var(--accent-pink); cursor: pointer; border-radius: 8px; }
    .btn-primary:hover { background: #FBCFE8; transform: translateY(-2px); box-shadow: 0 10px 30px -10px var(--accent-pink-soft); }
    .btn-primary svg { width: 14px; height: 14px; transition: transform 400ms var(--ease-quiet); }
    .btn-primary:hover svg { transform: translateX(6px); }
    .btn-ghost { color: var(--text-soft); font-family: 'Fira Code', monospace; font-size: 0.7rem; letter-spacing: 0.22em; text-transform: uppercase; transition: color 400ms var(--ease-quiet); display: inline-flex; align-items: center; gap: 0.6rem; cursor: pointer; }
    .btn-ghost:hover { color: var(--accent); }
    .btn-ghost::before { content: ''; display: inline-block; width: 24px; height: 1px; background: currentColor; transition: width 400ms var(--ease-quiet); }
    .btn-ghost:hover::before { width: 40px; }
    @media (max-width: 768px) { .hero { min-height: 92vh; padding: 6.5rem 1.5rem 4.5rem; } .hero__art img { object-position: 64% center; } .hero__art::before { background: linear-gradient(180deg, rgba(14,38,32,0.92) 0%, rgba(14,38,32,0.72) 48%, rgba(14,38,32,0.88) 100%); } }

    /* INTERLUDE */
    .interlude { padding: 6rem 2.5rem 9rem; background: var(--bg); }
    .interlude__inner { max-width: 1400px; margin: 0 auto; display: grid; grid-template-columns: 1.2fr 1fr; gap: 5rem; align-items: center; }
    .interlude__image { position: relative; aspect-ratio: 4 / 3; border-radius: 4px; overflow: hidden; border: 1px solid var(--line); opacity: 0; transform: translateY(40px); transition: opacity 1200ms var(--ease-quiet), transform 1200ms var(--ease-quiet); }
    .interlude__image.is-in { opacity: 1; transform: none; }
    .interlude__image img { width: 100%; height: 100%; object-fit: cover; filter: brightness(0.8) contrast(1.1) saturate(0.9); transition: transform 1400ms var(--ease-quiet); }
    .interlude__image:hover img { transform: scale(1.04); }
    .interlude__image::after { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(14, 38, 32, 0.5) 0%, transparent 40%, rgba(14, 38, 32, 0.4) 100%); pointer-events: none; }
    .interlude__text { opacity: 0; transform: translateY(40px); transition: opacity 1000ms var(--ease-quiet) 200ms, transform 1000ms var(--ease-quiet) 200ms; }
    .interlude__text.is-in { opacity: 1; transform: none; }
    .interlude__title { font-family: 'EB Garamond', serif; font-weight: 400; font-size: clamp(2rem, 4vw, 3.2rem); line-height: 1.15; letter-spacing: -0.015em; margin-bottom: 1.5rem; }
    .interlude__title em { font-style: italic; color: var(--accent); }
    .interlude__body { font-size: 1rem; line-height: 1.85; color: var(--text-soft); max-width: 460px; margin-bottom: 2rem; }
    .interlude__caption { font-family: 'Fira Code', monospace; font-size: 0.65rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-mute); padding-top: 1.5rem; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 0.8rem; }
    .interlude__caption::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
    @media (max-width: 1024px) { .interlude__inner { grid-template-columns: 1fr; gap: 3rem; } .interlude { padding: 5rem 1.5rem; } }

    /* JOURNEY */
    .journey { position: relative; background: var(--bg); }
    .journey__intro { padding: 9rem 2.5rem 4rem; max-width: 1400px; margin: 0 auto; }
    .journey__title { font-family: 'EB Garamond', serif; font-weight: 400; font-size: clamp(2.2rem, 5.5vw, 4.5rem); line-height: 1.1; letter-spacing: -0.015em; margin-bottom: 1.5rem; max-width: 18ch; }
    .journey__title em { font-style: italic; color: var(--accent); }
    .journey__sub { font-size: 1.05rem; line-height: 1.85; color: var(--text-soft); max-width: 620px; }
    .journey__viewport { position: relative; width: 100%; }
    .journey__pin { position: sticky; top: 0; height: 100vh; overflow: hidden; display: flex; align-items: center; justify-content: center; padding: 0 2.5rem; }
    .journey__track { --card-width: clamp(300px, 22vw, 410px); --card-overlap: clamp(16px, 1.8vw, 30px); display: flex; align-items: stretch; justify-content: flex-start; width: min(calc((var(--card-width) * 4) - (var(--card-overlap) * 3)), calc(100vw - 5rem)); max-width: 100%; overflow: visible; will-change: contents; }
    .journey__card { flex: 0 0 var(--card-width); min-width: 0; height: min(620px, calc(100vh - 8.5rem)); background: rgba(255,255,255,0.025); border: 1px solid var(--line); padding: clamp(1.35rem, 2.2vw, 2.5rem); display: flex; flex-direction: column; position: relative; opacity: 0; pointer-events: none; transform: translateY(28px) scale(0.985); transition: opacity 520ms var(--ease-quiet), transform 620ms var(--ease-emphasis), border-color 400ms var(--ease-quiet), background 400ms var(--ease-quiet); backdrop-filter: blur(12px); box-shadow: 0 30px 60px -20px rgba(0,0,0,0.5); border-radius: 4px; }
    .journey__card + .journey__card { margin-left: calc(var(--card-overlap) * -1); }
    .journey__card.is-visible { opacity: 1; pointer-events: auto; transform: translateY(0) scale(1); }
    .journey__card.is-active { border-color: var(--accent-soft); background: rgba(34, 211, 238, 0.035); }
    .journey__card:hover { border-color: var(--accent-soft); background: rgba(34, 211, 238, 0.03); }
    .journey__card-num { font-family: 'Fira Code', monospace; font-size: 0.7rem; letter-spacing: 0.2em; color: var(--accent); margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.6rem; }
    .journey__card-num span { color: var(--text-mute); }
    .journey__card-title { font-family: 'EB Garamond', serif; font-weight: 400; font-size: 2rem; line-height: 1.2; margin-bottom: 1.2rem; }
    .journey__card-desc { font-size: 0.95rem; line-height: 1.75; color: var(--text-soft); margin-bottom: 1.5rem; max-width: 46rem; }
    .journey__card-mockup { margin-top: auto; height: min(270px, calc(100vh - 20rem)); min-height: 230px; border: 1px solid var(--line); background: rgba(0,0,0,0.6); padding: 1.2rem; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; border-radius: 4px; }
    .journey__progress { position: absolute; bottom: 3rem; left: 50%; transform: translateX(-50%); width: 16rem; z-index: 3; }
    .journey__progress-track { width: 100%; height: 1px; background: var(--line); position: relative; margin-bottom: 0.8rem; }
    .journey__progress-bar { position: absolute; top: 0; left: 0; height: 100%; background: var(--accent); width: 0; transition: width 100ms linear; }
    .journey__progress-dots { position: absolute; top: 50%; left: 0; right: 0; display: flex; justify-content: space-between; transform: translateY(-50%); }
    .journey__progress-dot { width: 6px; height: 6px; background: var(--bg); border: 1px solid var(--line); border-radius: 50%; transition: all 300ms var(--ease-quiet); }
    .journey__progress-dot.active { background: var(--accent); border-color: var(--accent); box-shadow: 0 0 10px var(--accent-soft); }
    .journey__progress-label { font-family: 'Fira Code', monospace; font-size: 0.6rem; letter-spacing: 0.25em; color: var(--text-mute); text-transform: uppercase; display: flex; justify-content: space-between; }
    .journey__progress-label .current { color: var(--accent); }
    @media (max-width: 1280px) { .journey__track { --card-width: clamp(270px, 23vw, 330px); } .journey__card-title { font-size: 1.65rem; } .journey__card-desc { font-size: 0.86rem; line-height: 1.65; } }
    @media (max-width: 1024px) { .journey__pin { position: relative; height: auto; overflow-x: auto; justify-content: flex-start; scroll-snap-type: x mandatory; padding: 2rem 0; } .journey__track { width: auto; transform: none !important; padding: 0 1.5rem; } .journey__card { flex: 0 0 85%; height: auto; min-height: 620px; opacity: 1; pointer-events: auto; transform: none; scroll-snap-align: start; } .journey__card + .journey__card { margin-left: 1rem; } .journey__progress { display: none; } }
    @media (max-width: 768px) { .journey__card { min-height: 0; padding: 1.5rem; } .journey__card-mockup { height: 270px; min-height: 270px; } }

    /* MOCKUPS - 4 STEP UI */
    .mockup { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; position: relative; font-family: 'Inter', sans-serif; }
    .mockup--phone { border: 1px solid var(--line); border-radius: 20px; width: 160px; height: 230px; background: rgba(0,0,0,0.8); padding: 1.2rem 0.8rem; flex-direction: column; justify-content: flex-start; gap: 0.5rem; box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 20px 40px rgba(0,0,0,0.5); }
    .mockup__label { font-family: 'Fira Code', monospace; font-size: 0.5rem; letter-spacing: 0.18em; color: var(--text-mute); text-transform: uppercase; text-align: center; }
    .mockup__text { font-size: 0.55rem; color: var(--text-soft); text-align: center; line-height: 1.4; }
    .mockup__input { width: 100%; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 4px; padding: 0.5rem; color: var(--text); font-family: 'Fira Code', monospace; font-size: 0.55rem; text-align: center; }
    .mockup__btn-pink { width: 100%; background: var(--accent-pink); color: var(--bg); border-radius: 4px; padding: 0.5rem; font-size: 0.5rem; font-weight: 600; text-align: center; margin-top: 0.3rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .mockup__list-item { width: 100%; border: 1px solid var(--line); border-radius: 4px; padding: 0.4rem 0.5rem; font-size: 0.55rem; color: var(--text-soft); margin-bottom: 0.3rem; text-align: left; }
    .mockup__list-item.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }

    /* Step 3 specific clinic/time slots */
    .mockup__clinic-header { font-size: 0.6rem; color: var(--text); text-align: center; margin-bottom: 0.4rem; border-bottom: 1px solid var(--line); padding-bottom: 0.4rem; }
    .mockup__clinic-header span { display: block; font-size: 0.5rem; color: var(--text-mute); margin-top: 0.1rem; }
    .mockup__slot { width: 100%; display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--line); border-radius: 4px; padding: 0.35rem 0.4rem; font-size: 0.5rem; color: var(--text-mute); margin-bottom: 0.3rem; }
    .mockup__slot.active { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); }
    .mockup__slot.disabled { opacity: 0.4; }
    .mockup__slot .status { font-size: 0.45rem; font-weight: 500; }
    .mockup__slot .status.available { color: #4ADE80; }
    .mockup__slot.active .status.available { color: var(--accent); }
    .mockup__slot .status.unavailable { color: #F87171; }

    /* STEP 4: DUAL MOCKUP */
    .mockup--dual { display: flex; gap: clamp(0.45rem, 1vw, 0.8rem); width: 100%; height: 100%; justify-content: center; align-items: center; }
    .mockup__screen { border: 1px solid var(--line); border-radius: 8px; width: clamp(108px, 7.5vw, 145px); height: 215px; padding: 0.8rem 0.55rem; display: flex; flex-direction: column; gap: 0.35rem; }
    .mockup__screen--dark { background: rgba(0,0,0,0.85); color: var(--text); box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 10px 20px rgba(0,0,0,0.5); }
    .mockup__screen--light { background: var(--text); color: #333; box-shadow: 0 10px 20px rgba(0,0,0,0.5); }
    .mockup__screen-label { font-family: 'Fira Code', monospace; font-size: 0.45rem; letter-spacing: 0.1em; text-transform: uppercase; text-align: center; opacity: 0.7; }
    .mockup__screen--light .mockup__screen-label { opacity: 0.5; color: #000; }
    .mockup__token-num { font-family: 'EB Garamond', serif; font-size: clamp(2rem, 3.1vw, 2.8rem); text-align: center; line-height: 1; margin: 0.2rem 0; color: var(--accent); }
    .mockup__screen-row { display: flex; justify-content: space-between; font-size: 0.45rem; font-family: 'Fira Code', monospace; line-height: 1.3; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 0.2rem; }
    .mockup__screen-row span:first-child { opacity: 0.6; }
    .mockup__screen--light .mockup__screen-row { border-color: rgba(0,0,0,0.1); color: #444; }
    .mockup__appt-badge { background: #e0fbf3; border: 1px solid #b3f5e1; color: #0E2620; text-align: center; padding: 0.3rem; font-size: 0.45rem; font-weight: 700; letter-spacing: 0.05em; border-radius: 3px; margin-bottom: 0.2rem; }
    .mockup__screen-sub { font-size: 0.45rem; text-align: center; color: #666; line-height: 1.2; margin-bottom: 0.3rem; }
    .mockup__screen-btn { margin-top: auto; background: var(--accent-pink); color: var(--bg); text-align: center; padding: 0.35rem; font-size: 0.45rem; font-weight: 600; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em; }

    /* FEATURES */
    .features { border-top: 1px solid var(--line-soft); background: var(--bg); }
    .features__viewport { position: relative; width: 100%; }
    .features__pin { position: sticky; top: 0; min-height: 100vh; overflow: hidden; display: flex; align-items: center; padding: 5rem 2.5rem; }
    .features__inner { width: min(1320px, 100%); margin: 0 auto; }
    .features__head { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(360px, 0.82fr); gap: clamp(2.4rem, 5vw, 5.6rem); margin-bottom: clamp(2.2rem, 5vh, 4rem); align-items: end; }
    .features__title { font-family: 'EB Garamond', serif; font-weight: 400; font-size: clamp(2.2rem, 4.4vw, 3.9rem); line-height: 1.08; max-width: 13ch; letter-spacing: 0; }
    .features__title em { font-style: italic; color: var(--accent); }
    .features__sub { font-size: clamp(0.92rem, 1.1vw, 1rem); line-height: 1.75; color: var(--text-soft); max-width: 520px; justify-self: end; opacity: 0.82; }
    .features__list { display: grid; gap: 0.85rem; }
    .feature-row { display: grid; grid-template-columns: 64px minmax(220px, 0.78fr) minmax(0, 1.5fr) 150px; gap: clamp(1.25rem, 2.2vw, 2.3rem); padding: clamp(1.18rem, 2vh, 1.55rem) clamp(1.15rem, 2.2vw, 1.7rem); border: 1px solid var(--line); background: rgba(255,255,255,0.024); position: relative; align-items: center; opacity: 0; transform: translateX(90px); transition: opacity 620ms var(--ease-quiet), transform 760ms var(--ease-emphasis), border-color 400ms var(--ease-quiet), background 400ms var(--ease-quiet); backdrop-filter: blur(10px); border-radius: 4px; }
    .feature-row:nth-child(even) { transform: translateX(-90px); }
    .feature-row.is-visible { opacity: 1; transform: translateX(0); }
    .feature-row.is-active { border-color: var(--accent-soft); background: rgba(34, 211, 238, 0.035); }
    .feature-row::before { content: ''; position: absolute; left: 0; top: 0; width: 2px; height: 0; background: var(--accent); transition: height 700ms var(--ease-quiet); }
    .feature-row.is-active::before, .feature-row:hover::before { height: 100%; }
    .feature-row__num { font-family: 'Fira Code', monospace; font-size: 0.72rem; color: var(--accent); letter-spacing: 0.2em; }
    .feature-row__title { font-family: 'EB Garamond', serif; font-weight: 400; font-size: clamp(1.38rem, 1.95vw, 1.82rem); line-height: 1.16; letter-spacing: 0; }
    .feature-row__copy { min-width: 0; }
    .feature-row__desc { font-size: clamp(0.9rem, 1.05vw, 1rem); line-height: 1.62; color: var(--text-soft); opacity: 0.84; max-width: 58rem; }
    .feature-row__meta { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.9rem; }
    .feature-row__meta span { border: 1px solid rgba(34, 211, 238, 0.18); background: rgba(34, 211, 238, 0.055); color: rgba(220, 250, 255, 0.78); font-family: 'Fira Code', monospace; font-size: 0.56rem; letter-spacing: 0.1em; line-height: 1; text-transform: uppercase; padding: 0.48rem 0.58rem; border-radius: 3px; }
    .feature-row__tag { font-family: 'Fira Code', monospace; font-size: 0.6rem; line-height: 1.6; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-mute); text-align: right; }
    .feature-row.is-active .feature-row__tag, .feature-row:hover .feature-row__tag { color: var(--accent); }
    @media (max-width: 1024px) { .features__pin { position: relative; min-height: auto; overflow: visible; padding: 5.5rem 1.5rem; } .features__head { grid-template-columns: 1fr; margin-bottom: 2rem; } .features__title { max-width: 11ch; } .features__sub { justify-self: start; max-width: 42rem; } .features__list { gap: 1rem; } .feature-row { grid-template-columns: 54px 1fr; gap: 1rem 1.2rem; opacity: 1; transform: none !important; padding: 1.35rem 1.2rem; } .feature-row__title { font-size: clamp(1.45rem, 5vw, 1.9rem); } .feature-row__copy { grid-column: 1 / -1; } .feature-row__desc { font-size: 0.98rem; line-height: 1.68; } .feature-row__tag { grid-column: 1 / -1; text-align: left; font-size: 0.62rem; } }
    @media (max-width: 640px) { .features__pin { padding: 4.5rem 1rem; } .features__head { gap: 1.1rem; } .features__title { font-size: clamp(2.35rem, 12vw, 3.25rem); max-width: 10ch; } .features__sub { font-size: 1rem; line-height: 1.7; } .feature-row { grid-template-columns: 1fr; padding: 1.45rem 1.15rem; gap: 0.75rem; } .feature-row__num { font-size: 0.7rem; } .feature-row__copy, .feature-row__tag { grid-column: auto; } .feature-row__meta { gap: 0.45rem; margin-top: 0.8rem; } .feature-row__meta span { font-size: 0.52rem; padding: 0.45rem 0.5rem; } }

    /* CTA */
    .cta { min-height: 92vh; padding: 10rem 2.5rem; border-top: 1px solid var(--line-soft); position: relative; overflow: hidden; text-align: center; display: flex; align-items: center; justify-content: center; background-image: linear-gradient(180deg, rgba(14,38,32,0.58), rgba(14,38,32,0.84)), linear-gradient(90deg, rgba(14,38,32,0.9), rgba(14,38,32,0.42) 52%, rgba(14,38,32,0.86)), url('/krama-hero-clinic.png'); background-size: cover; background-position: center; }
    .cta::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(248, 180, 217, 0.18) 0%, rgba(14,38,32,0.08) 38%, rgba(14,38,32,0.62) 78%); z-index: 0; pointer-events: none; }
    .cta::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(14,38,32,0.72) 0%, transparent 18%, transparent 72%, rgba(14,38,32,0.82) 100%); z-index: 1; pointer-events: none; }
    .cta__inner { max-width: 900px; margin: 0 auto; position: relative; z-index: 2; text-shadow: 0 18px 50px rgba(0,0,0,0.55); }
    .cta__label { font-family: 'Fira Code', monospace; font-size: 0.7rem; letter-spacing: 0.3em; text-transform: uppercase; color: var(--accent); margin-bottom: 2.5rem; display: inline-flex; align-items: center; gap: 1rem; } .cta__label::before, .cta__label::after { content: ''; width: 2.5rem; height: 1px; background: var(--accent); }
    .cta__title { font-family: 'EB Garamond', serif; font-weight: 400; font-size: clamp(2.6rem, 5.7vw, 4.8rem); line-height: 1.08; margin-bottom: 2rem; color: #fff; } .cta__title em { font-style: italic; color: var(--accent-pink); }
    .cta__sub { font-size: 1.1rem; line-height: 1.85; color: rgba(230, 248, 242, 0.9); max-width: 650px; margin: 0 auto 3rem; }
    .cta__actions { display: flex; gap: 1.8rem; align-items: center; justify-content: center; flex-wrap: wrap; }
    .cta__fineprint { margin-top: 3rem; font-family: 'Fira Code', monospace; font-size: 0.65rem; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255,255,255,0.72); display: flex; gap: 2rem; justify-content: center; flex-wrap: wrap; }
    .cta__fineprint span { display: inline-flex; align-items: center; gap: 0.5rem; } .cta__fineprint span::before { content: ''; width: 4px; height: 4px; background: var(--accent); border-radius: 50%; }
    @media (max-width: 768px) { .cta { min-height: 86vh; padding: 6rem 1.5rem; background-position: 28% center; } .cta__label { font-size: 0.62rem; gap: 0.75rem; } .cta__label::before, .cta__label::after { width: 1.8rem; } .cta__title { font-size: clamp(2.35rem, 12vw, 3.55rem); } .cta__sub { font-size: 1rem; line-height: 1.7; } .cta__fineprint { gap: 0.9rem 1.2rem; font-size: 0.58rem; } }

    /* REVEAL */
    .reveal { opacity: 0; transform: translateY(40px); transition: opacity 1000ms var(--ease-quiet), transform 1000ms var(--ease-quiet); } .reveal.is-in { opacity: 1; transform: none; }
    .reveal-stagger > * { opacity: 0; transform: translateY(30px); transition: opacity 800ms var(--ease-quiet), transform 800ms var(--ease-quiet); } .reveal-stagger.is-in > * { opacity: 1; transform: none; } .reveal-stagger.is-in > *:nth-child(1) { transition-delay: 0ms; } .reveal-stagger.is-in > *:nth-child(2) { transition-delay: 120ms; } .reveal-stagger.is-in > *:nth-child(3) { transition-delay: 240ms; } .reveal-stagger.is-in > *:nth-child(4) { transition-delay: 360ms; }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } .hero__rain { display: none; } .line { transform: none !important; } }
  `;

  useEffect(() => {
    document.body.classList.add('krama-landing-page');

    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500;600&family=Fira+Code:wght@400&display=swap';
    document.head.appendChild(fontLink);

    const cvs = rainCanvasRef.current;
    const heroSection = heroRef.current;
    let resizeRain: (() => void) | undefined;
    if (cvs && heroSection && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const ctx = cvs.getContext('2d');
      if (ctx) {
        let drops: number[] = [];
        let isPlaying = true;
        const CHARS = '0123456789#AQ';
        const COL_WIDTH = 24;
        const FONT_SIZE = 14;

        const resize = () => {
          cvs.width = heroSection.offsetWidth;
          cvs.height = heroSection.offsetHeight;
          const cols = Math.floor(cvs.width / COL_WIDTH);
          drops = Array.from({ length: cols }, () => Math.random() * -cvs.height);
        };
        resize();
        resizeRain = resize;
        window.addEventListener('resize', resizeRain);

        const draw = () => {
          if (!isPlaying) { requestAnimationFrame(draw); return; }
          ctx.fillStyle = 'rgba(14, 38, 32, 0.10)';
          ctx.fillRect(0, 0, cvs.width, cvs.height);
          ctx.font = `${FONT_SIZE}px "Fira Code", monospace`;
          ctx.textBaseline = 'top';
          drops.forEach((y, i) => {
            const x = i * COL_WIDTH;
            const bright = Math.random() < 0.02;
            ctx.fillStyle = bright ? 'rgba(220, 250, 255, 1)' : 'rgba(34, 211, 238, 0.7)';
            ctx.fillText(CHARS[Math.floor(Math.random() * CHARS.length)], x, y);
            drops[i] = y > cvs.height && Math.random() > 0.975 ? 0 : y + 12;
          });
          requestAnimationFrame(draw);
        };
        draw();

        const observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => { isPlaying = entry.isIntersecting; });
        }, { threshold: 0 });
        observer.observe(heroSection);
      }
    }

    requestAnimationFrame(() => { heroRef.current?.classList.add('is-in'); });

    const reveals = document.querySelectorAll('.reveal, .reveal-stagger');
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -10% 0px' });
    reveals.forEach(el => revealObserver.observe(el));

    const viewport = journeyViewportRef.current;
    const track = journeyTrackRef.current;
    const progressBar = journeyProgressBarRef.current;
    const dots = journeyDotsRef.current?.querySelectorAll('.journey__progress-dot') || [];
    const currentLabel = journeyCurrentRef.current;
    const featuresViewport = featuresViewportRef.current;
    const featureRows = featuresViewport ? Array.from(featuresViewport.querySelectorAll('.feature-row')) as HTMLElement[] : [];

    const mq = window.matchMedia('(min-width: 1025px)');
    const cards = track ? Array.from(track.children) as HTMLElement[] : [];
    let stepScroll = 0;
    let revealDistance = 0;
    let activeIndex = -1;
    let featureStepScroll = 0;
    let featureRevealDistance = 0;
    let activeFeatureIndex = -2;

    const recalc = () => {
      if (!mq.matches) {
        if (viewport) viewport.style.height = 'auto';
        if (featuresViewport) featuresViewport.style.height = 'auto';
        cards.forEach(card => {
          card.classList.add('is-visible');
          card.classList.remove('is-active');
        });
        featureRows.forEach(row => {
          row.classList.add('is-visible');
          row.classList.remove('is-active');
        });
        return;
      }
      if (viewport) {
        stepScroll = Math.max(300, Math.round(window.innerHeight * 0.5));
        revealDistance = (stepScroll * Math.max(1, cards.length - 1)) + 160;
        viewport.style.height = (window.innerHeight + revealDistance) + 'px';
      }
      if (featuresViewport) {
        featureStepScroll = Math.max(240, Math.round(window.innerHeight * 0.34));
        featureRevealDistance = (featureStepScroll * Math.max(1, featureRows.length - 1)) + 180;
        featuresViewport.style.height = (window.innerHeight + featureRevealDistance) + 'px';
      }
    };
    recalc();
    window.addEventListener('resize', recalc);

    const updateProgress = (p: number) => {
      if (progressBar) progressBar.style.width = (p * 100) + '%';
      const totalCards = dots.length;
      const dotIndex = Math.min(totalCards - 1, Math.floor(p * totalCards));
      dots.forEach((dot, i) => {
        if (i === dotIndex) dot.classList.add('active');
        else dot.classList.remove('active');
      });
      if (currentLabel) {
        currentLabel.textContent = String(dotIndex + 1).padStart(2, '0') + ' / 0' + totalCards;
      }
    };

    const revealCards = (index: number) => {
      if (index === activeIndex) return;
      activeIndex = index;
      cards.forEach((card, i) => {
        card.classList.toggle('is-visible', i <= index);
        card.classList.toggle('is-active', i === index);
        card.style.zIndex = String(i + 1);
      });
    };

    const revealFeatures = (index: number) => {
      if (index === activeFeatureIndex) return;
      activeFeatureIndex = index;
      featureRows.forEach((row, i) => {
        row.classList.toggle('is-visible', i <= index);
        row.classList.toggle('is-active', i === index);
      });
    };

    const handleJourneyScroll = () => {
      if (!mq.matches || !viewport || !track) return;
      const rect = viewport.getBoundingClientRect();
      const top = rect.top;

      if (top <= 0 && top >= -revealDistance) {
        const p = Math.min(0.999, Math.max(0, -top / revealDistance));
        const index = Math.min(cards.length - 1, Math.floor((-top + 1) / stepScroll));
        revealCards(index);
        updateProgress(p);
      } else if (top > 0) {
        revealCards(0);
        updateProgress(0);
      } else if (top < -revealDistance) {
        revealCards(cards.length - 1);
        updateProgress(1);
      }
    };

    const handleFeaturesScroll = () => {
      if (!mq.matches || !featuresViewport || featureRows.length === 0) return;
      const top = featuresViewport.getBoundingClientRect().top;

      if (top <= 0 && top >= -featureRevealDistance) {
        const index = Math.min(featureRows.length - 1, Math.floor((-top + 1) / featureStepScroll));
        revealFeatures(index);
      } else if (top > 0) {
        revealFeatures(-1);
      } else if (top < -featureRevealDistance) {
        revealFeatures(featureRows.length - 1);
      }
    };

    handleJourneyScroll();
    handleFeaturesScroll();
    window.addEventListener('scroll', handleJourneyScroll, { passive: true });
    window.addEventListener('scroll', handleFeaturesScroll, { passive: true });

    return () => {
      if (resizeRain) window.removeEventListener('resize', resizeRain);
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', handleJourneyScroll);
      window.removeEventListener('scroll', handleFeaturesScroll);
      document.head.removeChild(fontLink);
      document.body.classList.remove('krama-landing-page');
    };
  }, []);

  return (
    <>
      <style>{css}</style>

      {/* HERO (No Nav included) */}
      <section className="hero" ref={heroRef}>
        <div className="hero__art">
          <img src="/krama-hero-cartoon-reception.png" alt="Cartoon clinic reception with patients waiting calmly" />
        </div>
        <div className="hero__vignette"></div>
        <div className="hero__content">
          <div className="hero__eyebrow">Clinic &amp; Patient Queue System</div>
          <h1 className="hero__title">
            <span className="line-mask"><span className="line">The waiting room,</span></span>
            <span className="line-mask"><span className="line">finally <em>honest</em></span></span>
            <span className="line-mask"><span className="line">with you.</span></span>
          </h1>
          <p className="hero__sub">
            Patients usually suffer through long wait times and booking headaches. Krama fixes the queue by showing real-time slots, live delays, and exact token positions, while our AI summarizes visits and guides your care.
          </p>
          <div className="hero__cta">
            <a href="#cta" className="btn-primary">
              Patient Login
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </a>
            <a href="#journey" className="btn-ghost">See the 4-step journey</a>
          </div>
        </div>
      </section>

      {/* INTERLUDE */}
      <section className="interlude">
        <div className="interlude__inner">
          <div className="interlude__image reveal">
            <img src="/krama-hero-cartoon-reception.png" alt="Cartoon clinic reception and waiting room" />
          </div>
          <div className="interlude__text reveal">
            <div className="section-label" style={{ marginBottom: '2rem' }}>The Waiting Room</div>
            <h2 className="interlude__title">A space designed for anxiety, dressed up as a <em>lounge</em>.</h2>
            <p className="interlude__body">The main issue in healthcare isn't the schedule—it's managing the crowd. When a patient knows exactly when they'll be seen, the room stops being a waiting room. It becomes what it was always meant to be: a brief pause before care.</p>
            <div className="interlude__caption">Clinic partner · Accra, Ghana</div>
          </div>
        </div>
      </section>

      {/* JOURNEY (4-STEP HORIZONTAL) */}
      <section className="journey" id="journey">
        <div className="journey__intro">
          <div className="section-label reveal">The patient's hour, rebuilt</div>
          <h2 className="journey__title reveal">Four steps from login<br />to <em>your token</em>.</h2>
          <p className="journey__sub reveal">We stripped the appointment journey down to exactly four steps. Login securely, state your reason, pick the fastest clinic, and get your token. No phone calls, no clipboards, no guessing when your turn is coming.</p>
        </div>

        <div className="journey__viewport" ref={journeyViewportRef}>
          <div className="journey__pin">
            <div className="journey__track" ref={journeyTrackRef}>
              
              {/* STEP 1 */}
              <div className="journey__card">
                <div className="journey__card-num">01 <span>/ 04</span></div>
                <h3 className="journey__card-title">Login to our site.</h3>
                <p className="journey__card-desc">Patients access Krama via web or mobile, entering their phone number to receive a quick OTP. No passwords to remember, no lengthy registration—just secure, frictionless entry to care.</p>
                <div className="journey__card-mockup">
                  <div className="mockup mockup--phone">
                    <div className="mockup__label">Patient Login</div>
                    <div className="mockup__input">+233 24 123 4567</div>
                    <div className="mockup__btn-pink">Send OTP</div>
                    <div className="mockup__text" style={{ marginTop: '0.5rem' }}>Secure access via SMS</div>
                  </div>
                </div>
              </div>

              {/* STEP 2 */}
              <div className="journey__card">
                <div className="journey__card-num">02 <span>/ 04</span></div>
                <h3 className="journey__card-title">Book the appointment.</h3>
                <p className="journey__card-desc">Select the reason for your visit. Krama uses this to allocate the right amount of time with the doctor, ensuring the schedule stays honest and the patient gets exactly the care they need.</p>
                <div className="journey__card-mockup">
                  <div className="mockup mockup--phone">
                    <div className="mockup__label">Reason for Visit</div>
                    <div className="mockup__list-item active">General Consultation</div>
                    <div className="mockup__list-item">Follow-up Visit</div>
                    <div className="mockup__list-item">Lab Test Only</div>
                  </div>
                </div>
              </div>

              {/* STEP 3: CLINIC & TIME SLOTS */}
              <div className="journey__card">
                <div className="journey__card-num">03 <span>/ 04</span></div>
                <h3 className="journey__card-title">Choose the clinic.</h3>
                <p className="journey__card-desc">Pick from partner clinics and available time slots. Krama shows real-time availability, so patients can choose the fastest path to care instead of guessing.</p>
                <div className="journey__card-mockup">
                  <div className="mockup mockup--phone">
                    <div className="mockup__label">Select Time Slot</div>
                    <div className="mockup__clinic-header">
                      Dugar Clinic
                      <span>Dr. Duganth</span>
                    </div>
                    <div className="mockup__slot">
                      <span>Time 3</span>
                      <span className="status available">6:00AM - 11:00PM</span>
                    </div>
                    <div className="mockup__slot active">
                      <span>Time 2</span>
                      <span className="status available">3:00PM - 5:00PM</span>
                    </div>
                    <div className="mockup__slot disabled">
                      <span>Time 1</span>
                      <span className="status unavailable">8:00AM - 11:00AM</span>
                    </div>
                    <div className="mockup__btn-pink">Book Appointment</div>
                  </div>
                </div>
              </div>

              {/* STEP 4 */}
              <div className="journey__card">
                <div className="journey__card-num">04 <span>/ 04</span></div>
                <h3 className="journey__card-title">View your token details.</h3>
                <p className="journey__card-desc">Booking confirmed. The patient instantly sees their token number, live queue position, and the estimated time they'll be seen. The dashboard updates in real-time as the queue moves.</p>
                <div className="journey__card-mockup">
                  <div className="mockup--dual">
                    {/* Left: Green Phone */}
                    <div className="mockup__screen mockup__screen--dark">
                      <div className="mockup__screen-label">Your Token</div>
                      <div className="mockup__token-num">T-047</div>
                      <div className="mockup__screen-row"><span>Ahead</span><span>3 people</span></div>
                      <div className="mockup__screen-row"><span>Position</span><span>4 of 12</span></div>
                      <div className="mockup__screen-row"><span>Est. wait</span><span>~14m</span></div>
                      <div className="mockup__screen-row"><span>Around</span><span>1:40 PM</span></div>
                    </div>
                    {/* Right: White Card */}
                    <div className="mockup__screen mockup__screen--light">
                      <div className="mockup__appt-badge">APPT CONFIRMED</div>
                      <div className="mockup__screen-sub">Keep token open.</div>
                      <div className="mockup__screen-row"><span>Serving</span><span>T-047</span></div>
                      <div className="mockup__screen-row"><span>Window</span><span>1:40 PM</span></div>
                      <div className="mockup__screen-row"><span>Clinic</span><span>Dugar</span></div>
                      <div className="mockup__screen-row"><span>Doctor</span><span>Dr. Duganth</span></div>
                      <div className="mockup__screen-btn">Dashboard</div>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            <div className="journey__progress">
              <div className="journey__progress-track">
                <div className="journey__progress-bar" ref={journeyProgressBarRef}></div>
                <div className="journey__progress-dots" ref={journeyDotsRef}>
                  <span className="journey__progress-dot active"></span>
                  <span className="journey__progress-dot"></span>
                  <span className="journey__progress-dot"></span>
                  <span className="journey__progress-dot"></span>
                </div>
              </div>
              <div className="journey__progress-label">
                <span>Stage</span>
                <span className="current" ref={journeyCurrentRef}>01 / 04</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="features" id="features">
        <div className="features__viewport" ref={featuresViewportRef}>
          <div className="features__pin">
            <div className="features__inner">
          <div className="features__head">
            <h2 className="features__title reveal">What's actually<br />under the <em>hood</em>.</h2>
            <p className="features__sub reveal">Krama is built around one hard problem: keeping clinic time honest. The system connects live queues, doctor slots, delays, reports, and AI visit notes without making the patient guess.</p>
          </div>
          <div className="features__list">
            <div className="feature-row">
              <div className="feature-row__num">01</div>
              <h3 className="feature-row__title">Crowd control patients can trust</h3>
              <div className="feature-row__copy">
                <p className="feature-row__desc">Krama replaces blind waiting with a digital queue. Patients see their exact position, so the waiting room becomes calmer and the front desk gets fewer repeated questions.</p>
                <div className="feature-row__meta"><span>Live position</span><span>Fewer calls</span><span>Calmer lobby</span></div>
              </div>
              <div className="feature-row__tag">Digital Queue<br />Crowd Control</div>
            </div>
            <div className="feature-row">
              <div className="feature-row__num">02</div>
              <h3 className="feature-row__title">Doctor slots with real boundaries</h3>
              <div className="feature-row__copy">
                <p className="feature-row__desc">Clinics define clear doctor sessions, like morning and evening slots. Patients only book into available time, which helps prevent overlap and keeps the schedule easier to manage.</p>
                <div className="feature-row__meta"><span>Session rules</span><span>Doctor-wise</span><span>No overlap</span></div>
              </div>
              <div className="feature-row__tag">Time Control<br />Live Availability</div>
            </div>
            <div className="feature-row">
              <div className="feature-row__num">03</div>
              <h3 className="feature-row__title">Live delay updates</h3>
              <div className="feature-row__copy">
                <p className="feature-row__desc">When a doctor runs late, staff can add a delay once. Krama recalculates ETAs and keeps patients informed, so they can wait somewhere comfortable instead of guessing.</p>
                <div className="feature-row__meta"><span>One-tap delay</span><span>ETA refresh</span><span>Patient alerts</span></div>
              </div>
              <div className="feature-row__tag">Instant Updates<br />Transparent ETAs</div>
            </div>
            <div className="feature-row">
              <div className="feature-row__num">04</div>
              <h3 className="feature-row__title">AI summaries for the next visit</h3>
              <div className="feature-row__copy">
                <p className="feature-row__desc">Visit notes are summarized into clear clinical context. The next doctor can quickly understand what happened before without digging through long, scattered records.</p>
                <div className="feature-row__meta"><span>Visit context</span><span>Quick review</span><span>History ready</span></div>
              </div>
              <div className="feature-row__tag">AI-Powered<br />History Synced</div>
            </div>
            <div className="feature-row">
              <div className="feature-row__num">05</div>
              <h3 className="feature-row__title">Clear guidance after care</h3>
              <div className="feature-row__copy">
                <p className="feature-row__desc">Patients leave with simple next steps: what to take, what to avoid, and what to do next. The important instructions stay readable after the appointment is over.</p>
                <div className="feature-row__meta"><span>Medication notes</span><span>Avoid list</span><span>Next steps</span></div>
              </div>
              <div className="feature-row__tag">Patient View<br />Clear Steps</div>
            </div>
            <div className="feature-row">
              <div className="feature-row__num">06</div>
              <h3 className="feature-row__title">Reports and reminders in one flow</h3>
              <div className="feature-row__copy">
                <p className="feature-row__desc">Clinics can send reports through Krama and schedule follow-up reminders. The patient gets the right document and the next visit does not depend on memory.</p>
                <div className="feature-row__meta"><span>PDF reports</span><span>Follow-ups</span><span>Reminders</span></div>
              </div>
              <div className="feature-row__tag">Secure Reports<br />Auto-Reminders</div>
            </div>
          </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta" id="cta">
        <div className="cta__inner">
          <div className="cta__label">Stop The Wait</div>
          <h2 className="cta__title">Patients suffer long wait times.<br /><em>It's time to fix it.</em></h2>
          <p className="cta__sub">Give patients live token updates, honest ETAs, and the freedom to wait anywhere. Krama keeps the number, timing, and next step clear from booking to follow-up.</p>
          <div className="cta__actions">
            <a href="#" className="btn-primary">
              Start using Krama
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </a>
            <a href="#journey" className="btn-ghost">See how it works</a>
          </div>
          <div className="cta__fineprint">
            <span>Live ETAs</span>
            <span>AI Summaries</span>
            <span>No app required</span>
            <span>6-day setup</span>
          </div>
        </div>
      </section>
    </>
  );
};

export default KramaLandingPage;
