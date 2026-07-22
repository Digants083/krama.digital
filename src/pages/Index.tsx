import React, { useEffect, useRef } from 'react';
import "./Index.css";

const KramaLandingPage: React.FC = () => {
  const heroRef = useRef<HTMLElement>(null);
  const rainCanvasRef = useRef<HTMLCanvasElement>(null);
  const journeyViewportRef = useRef<HTMLDivElement>(null);
  const journeyTrackRef = useRef<HTMLDivElement>(null);
  const journeyProgressBarRef = useRef<HTMLDivElement>(null);
  const journeyCurrentRef = useRef<HTMLSpanElement>(null);
  const journeyDotsRef = useRef<HTMLDivElement>(null);
  const featuresViewportRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    document.body.classList.add('krama-landing-page');

    const fontLink = document.createElement('link');
    fontLink.rel = 'preload';
    fontLink.as = 'style';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@300;400;500;600&family=Fira+Code:wght@400&display=swap';
    fontLink.onload = () => { fontLink.rel = 'stylesheet'; };
    document.head.appendChild(fontLink);

    const cvs = rainCanvasRef.current;
    const heroSection = heroRef.current;
    let resizeRain: (() => void) | undefined;
    let rainAnimationFrame: number | undefined;
    let rainObserver: IntersectionObserver | undefined;
    if (cvs && heroSection && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const ctx = cvs.getContext('2d');
      if (ctx) {
        let drops: number[] = [];
        let isPlaying = false;
        let frameCount = 0;
        const CHARS = '0123456789#AQ';
        const COL_WIDTH = 24;
        const FONT_SIZE = 14;
        const FRAME_SKIP = 3;

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
          if (!isPlaying) return;
          frameCount++;
          ctx.fillStyle = 'rgba(14, 38, 32, 0.06)';
          ctx.fillRect(0, 0, cvs.width, cvs.height);
          ctx.font = `${FONT_SIZE}px "Fira Code", monospace`;
          ctx.textBaseline = 'top';
          const skipUpdate = frameCount % FRAME_SKIP !== 0;
          drops.forEach((y, i) => {
            const x = i * COL_WIDTH;
            ctx.fillStyle = 'rgba(34, 211, 238, 0.6)';
            ctx.fillText(CHARS[Math.floor(Math.random() * CHARS.length)], x, y);
            if (!skipUpdate) {
              drops[i] = y > cvs.height && Math.random() > 0.975 ? 0 : y + 12;
            }
          });
          rainAnimationFrame = requestAnimationFrame(draw);
        };

        rainObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting && !isPlaying) {
              isPlaying = true;
              rainAnimationFrame = requestAnimationFrame(draw);
            } else if (!entry.isIntersecting && isPlaying) {
              isPlaying = false;
              if (rainAnimationFrame !== undefined) cancelAnimationFrame(rainAnimationFrame);
            }
          });
        }, { threshold: 0 });
        rainObserver.observe(heroSection);
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
    let scrollRaf: number | undefined;
    const onScroll = () => {
      if (scrollRaf !== undefined) cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => {
        handleJourneyScroll();
        handleFeaturesScroll();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      if (rainAnimationFrame !== undefined) cancelAnimationFrame(rainAnimationFrame);
      if (scrollRaf !== undefined) cancelAnimationFrame(scrollRaf);
      rainObserver?.disconnect();
      if (resizeRain) window.removeEventListener('resize', resizeRain);
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', onScroll);
      document.head.removeChild(fontLink);
      document.body.classList.remove('krama-landing-page');
    };
  }, []);

  return (
    <>
      {/* HERO (No Nav included) */}
      <section className="hero" ref={heroRef}>
        <div className="hero__art">
          <img src="/krama-hero-cartoon-reception.webp" alt="Cartoon clinic reception with patients waiting calmly" width="1662" height="946" fetchpriority="high" decoding="async" />
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
            <picture>
              <source media="(max-width: 768px)" srcSet="/krama-token-phone-patient.webp" />
              <img src="/krama-token-phone-patient-wide.webp" alt="Patient checking a clinic queue token on a phone" width="1774" height="886" loading="lazy" decoding="async" />
            </picture>
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
