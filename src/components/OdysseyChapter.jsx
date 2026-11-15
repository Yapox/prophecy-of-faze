import { useRef } from 'react';
import { m, useReducedMotion, useScroll, useTransform } from 'motion/react';

function Artwork({ figure, eager = false }) {
  const landscape = figure === 'ithaca';
  const base = import.meta.env.BASE_URL || '/';
  return <picture>
    <source media="(max-width: 640px)" srcSet={`${base}odyssey/${figure}-mobile.webp`} />
    <img src={`${base}odyssey/${figure}-desktop.webp`} alt="" width={landscape ? 1440 : 960} height={landscape ? 720 : 1440} loading={eager ? 'eager' : 'lazy'} fetchpriority={eager ? 'high' : 'low'} decoding="async" draggable="false" />
  </picture>;
}

function Waves() {
  return <svg className="odyssey-waves" viewBox="0 0 1440 160" fill="none" preserveAspectRatio="none" aria-hidden="true"><g stroke="currentColor" strokeWidth="1"><path d="M-80 65C80 5 140 125 300 65S520 5 680 65S900 125 1060 65S1280 5 1520 65" /><path d="M-80 95C80 35 140 155 300 95S520 35 680 95S900 155 1060 95S1280 35 1520 95" /><path d="M-80 125C80 65 140 185 300 125S520 65 680 125S900 185 1060 125S1280 65 1520 125" /></g></svg>;
}

function ScrollArtwork({ target, figure, eager, waves }) {
  const { scrollYProgress } = useScroll({ target, offset: ['start end', 'end start'] });
  const opacity = useTransform(scrollYProgress, [0, 0.22, 0.65, 1], [0, 0.3, 0.3, 0]);
  const shift = useTransform(scrollYProgress, [0, 1], ['72px', '-72px']);
  const scale = useTransform(scrollYProgress, [0, 1], [1.04, 1]);
  const waveShift = useTransform(scrollYProgress, [0, 1], ['36px', '-36px']);
  return <>
    <m.div className="odyssey-art" aria-hidden="true" style={{ opacity, '--odyssey-shift': shift, '--odyssey-scale': scale }}><Artwork figure={figure} eager={eager} /></m.div>
    {waves && <m.div className="odyssey-wave-layer" aria-hidden="true" style={{ opacity, '--wave-shift': waveShift }}><Waves /></m.div>}
  </>;
}

export default function OdysseyChapter({ figure, className = '', children, eager = false, waves = false, ...props }) {
  const target = useRef(null);
  const reducedMotion = useReducedMotion();
  return <section ref={target} className={`odyssey-chapter chapter-${figure} ${className}`} data-figure={figure} data-motion={reducedMotion ? 'static' : 'scroll'} {...props}>
    {reducedMotion ? <><div className="odyssey-art odyssey-art-static" aria-hidden="true"><Artwork figure={figure} eager={eager} /></div>{waves && <div className="odyssey-wave-layer odyssey-art-static" aria-hidden="true"><Waves /></div>}</> : <ScrollArtwork target={target} figure={figure} eager={eager} waves={waves} />}
    <m.div className="chapter-content" initial={reducedMotion || eager ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.08 }} transition={{ duration: reducedMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}>{children}</m.div>
  </section>;
}
