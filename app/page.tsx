"use client";

import { useRouter } from "next/navigation";
import React, { useState, useEffect, useRef, useCallback } from 'react';

const DATASETS = [
  { 
    name: 'orders.csv', 
    rows: '12,438', 
    note: 'Recognized as your order ledger. customer_id links to customers.csv; totals reconcile with transactions.csv.',
    columns: [['order_id','id'],['customer_id','ref'],['ordered_at','date'],['items','number'],['total','money'],['status','enum']] 
  },
  { 
    name: 'customers.csv', 
    rows: '3,109', 
    note: 'Profiles keyed by customer_id. Segment and first_order enable cohort and lifecycle analysis.',
    columns: [['customer_id','id'],['first_order','date'],['city','text'],['segment','enum'],['ltv','money']] 
  },
  { 
    name: 'products.csv', 
    rows: '486', 
    note: 'Catalog keyed by sku. Cost and price are compared to compute true margin contribution.',
    columns: [['sku','id'],['category','enum'],['cost','money'],['price','money'],['stock','number']] 
  },
  { 
    name: 'transactions.csv', 
    rows: '30,204', 
    note: 'Payment records tied to orders via order_id — fees reconcile against order totals.',
    columns: [['txn_id','id'],['order_id','ref'],['method','enum'],['amount','money'],['fee','money']] 
  },
  { 
    name: 'returns.csv', 
    rows: '612', 
    note: 'Return events linked to orders. Reason codes will feed product risk scoring.',
    columns: [['return_id','id'],['order_id','ref'],['reason','enum'],['refund','money']] 
  }
];

const PHRASES = [
  'joining orders ↔ customers…',
  'profiling column meanings…',
  'scoring cross-sell pairs…',
  'detecting reorder cycles…',
  'measuring margin erosion…'
];

export default function HelperX() {
  const router = useRouter();

  const [scrolled, setScrolled] = useState(false);
  const [hubStatus, setHubStatus] = useState(PHRASES[0]);
  const [dsIndex, setDsIndex] = useState(0);
  const [dsInnerVisible, setDsInnerVisible] = useState(true);

  const workspaceRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const stepsFillRef = useRef<HTMLDivElement>(null);
  const heroVizRef = useRef<SVGSVGElement>(null);
  const dsHoldRef = useRef(0);

  // Scroll Nav Effect
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 24);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Intersection Observer for Reveal elements
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    document.querySelectorAll('[data-reveal]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Hero Hub Status Cycler
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let pi = 0;
    const interval = setInterval(() => {
      pi = (pi + 1) % PHRASES.length;
      setHubStatus(PHRASES[pi]);
    }, 3600);
    return () => clearInterval(interval);
  }, []);

  // Hero Viz Particles along paths
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const svg = heroVizRef.current;
    if (!svg) return;
    const NS = 'http://www.w3.org/2000/svg';
    const XL = 'http://www.w3.org/1999/xlink';
    
    const paths = svg.querySelectorAll<SVGPathElement>('.viz-path[data-flow]');
    const createdElements: Element[] = [];

    paths.forEach((path, idx) => {
      const isOut = path.getAttribute('data-flow') === 'out';
      const count = isOut ? 3 : 2;
      const dur = 6 + (idx % 3) * 0.9;
      const pathId = path.id;

      for (let i = 0; i < count; i++) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('r', isOut ? '2.4' : '2.1');
        c.setAttribute('fill', isOut ? '#43533B' : '#7E9271');
        c.setAttribute('opacity', '0');
        const begin = (isOut ? 1.7 : 1.3) + idx * 0.32 + i * (dur / count) + Math.random() * 0.5;
        
        const am = document.createElementNS(NS, 'animateMotion');
        am.setAttribute('dur', `${dur}s`);
        am.setAttribute('begin', `${begin}s`);
        am.setAttribute('repeatCount', 'indefinite');
        
        const mp = document.createElementNS(NS, 'mpath');
        mp.setAttribute('href', `#${pathId}`);
        mp.setAttributeNS(XL, 'xlink:href', `#${pathId}`);
        
        am.appendChild(mp);
        c.appendChild(am);

        const op = document.createElementNS(NS, 'animate');
        op.setAttribute('attributeName', 'opacity');
        op.setAttribute('values', '0;.85;.85;0');
        op.setAttribute('keyTimes', '0;.12;.78;1');
        op.setAttribute('dur', `${dur}s`);
        op.setAttribute('begin', `${begin}s`);
        op.setAttribute('repeatCount', 'indefinite');
        c.appendChild(op);

        if (path.parentNode) {
          path.parentNode.insertBefore(c, path.nextSibling);
          createdElements.push(c);
        }
      }
    });

    return () => {
      createdElements.forEach(el => el.remove());
    };
  }, []);

  // Workspace Dataset Auto-rotation
  useEffect(() => {
    let isVisible = false;
    const panel = workspaceRef.current;
    if (!panel) return;

    const observer = new IntersectionObserver(([en]) => {
      isVisible = en.isIntersecting;
    }, { threshold: 0.2 });
    observer.observe(panel);

    const interval = setInterval(() => {
      if (!isVisible || Date.now() < dsHoldRef.current || panel.matches(':hover')) return;
      setDsInnerVisible(false);
      setTimeout(() => {
        setDsIndex((prev) => (prev + 1) % DATASETS.length);
        setDsInnerVisible(true);
      }, 200);
    }, 4600);

    return () => {
      observer.disconnect();
      clearInterval(interval);
    };
  }, []);

  const selectDataset = (index: number, manual: boolean) => {
    setDsInnerVisible(false);
    setTimeout(() => {
      setDsIndex(index);
      setDsInnerVisible(true);
    }, 150);
    if (manual) dsHoldRef.current = Date.now() + 12000;
  };

  // Workflow steps scroll progress
  useEffect(() => {
    const updateSteps = () => {
      const stepsEl = stepsRef.current;
      const fill = stepsFillRef.current;
      if (!stepsEl || !fill) return;

      const r = stepsEl.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      const p = Math.min(1, Math.max(0, (window.innerHeight * 0.65 - r.top) / r.height));
      const h = p * r.height;
      fill.style.height = `${h}px`;
      const fillBottom = r.top + h;

      stepsEl.querySelectorAll('.step').forEach((s) => {
        const n = s.querySelector('.step-num')?.getBoundingClientRect();
        if (n) {
          s.classList.toggle('passed', n.top + n.height * 0.5 <= fillBottom);
        }
      });
    };

    window.addEventListener('scroll', updateSteps, { passive: true });
    window.addEventListener('resize', updateSteps);
    updateSteps();
    return () => {
      window.removeEventListener('scroll', updateSteps);
      window.removeEventListener('resize', updateSteps);
    };
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        /* ============ base ============ */
        :root{
          --paper:#F5F3ED; --surface:#FBFAF6; --surface-2:#FDFCF8;
          --ink:#1F231D; --ink-2:#4E5349; --ink-3:#8B8F82;
          --line:#E2DED2; --line-2:#D2CDC0;
          --sage:#5F7355; --sage-deep:#33463A; --sage-mid:#8FA07E; --sage-pale:#E9EEDD;
          --ochre:#8A7440; --clay:#B9834F; --clay-deep:#9C5B33;
          --serif:'Fraunces',Georgia,serif; --sans:'Instrument Sans',sans-serif; --mono:'Spline Sans Mono',ui-monospace,monospace;
        }
        *{margin:0;padding:0;box-sizing:border-box}
        html{scroll-behavior:smooth;scroll-padding-top:92px}
        body{font:400 16px/1.6 var(--sans);background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased;overflow-x:hidden}
        body::after{content:"";position:fixed;inset:0;z-index:200;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.12 0 0 0 0 0.13 0 0 0 0 0.10 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E")}
        ::selection{background:#D8E0C8}
        :focus-visible{outline:2px solid #6B7F5C;outline-offset:2px;border-radius:4px}
        .container{max-width:1160px;margin:0 auto;padding:0 32px}
        h1,h2,h3{font-family:var(--serif);font-weight:500;letter-spacing:-.015em;color:var(--ink)}
        h1 em,h2 em{font-style:italic;font-weight:500;color:var(--sage-deep)}
        button{font-family:var(--sans)}
        svg{display:block}

        /* ============ buttons ============ */
        .btn{display:inline-flex;align-items:center;gap:10px;font:500 15px/1 var(--sans);border-radius:999px;padding:15px 28px;cursor:pointer;border:1px solid transparent;text-decoration:none;transition:background .25s ease,border-color .25s ease,transform .25s ease,color .25s ease}
        .btn svg{width:15px;height:15px;transition:transform .25s ease}
        .btn-primary{background:var(--sage-deep);color:#F4F2E9}
        .btn-primary:hover{background:#28392E;transform:translateY(-1px)}
        .btn-primary:hover svg{transform:translateX(3px)}
        .btn-ghost{color:var(--sage-deep);border-color:#CFC9B8;background:transparent}
        .btn-ghost:hover{border-color:var(--sage);background:#EFEDE2}
        .btn-small{padding:11px 20px;font-size:14px}
        .btn-large{padding:18px 38px;font-size:16px}
        .link-btn{background:none;border:none;padding:0;font:inherit;font-size:inherit;color:var(--sage-deep);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
        .link-btn:hover{color:var(--ink)}

        /* ============ nav ============ */
        .nav{position:fixed;top:0;left:0;right:0;z-index:50;transition:background .35s ease,border-color .35s ease,backdrop-filter .35s ease;border-bottom:1px solid transparent}
        .nav.scrolled{background:rgba(245,243,237,.86);backdrop-filter:blur(12px) saturate(1.2);border-bottom-color:var(--line)}
        .nav-inner{max-width:1160px;margin:0 auto;padding:18px 32px;display:flex;align-items:center;gap:36px}
        .brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--sage-deep)}
        .brand-mark{width:26px;height:26px}
        .brand-name{font:500 19px var(--serif);letter-spacing:-.01em}
        .nav-links{display:flex;gap:28px;margin-left:12px}
        .nav-links a{font:500 14px var(--sans);color:var(--ink-2);text-decoration:none;position:relative;padding:4px 0}
        .nav-links a::after{content:"";position:absolute;left:0;bottom:0;width:100%;height:1.5px;background:var(--sage);transform:scaleX(0);transform-origin:left;transition:transform .3s ease}
        .nav-links a:hover{color:var(--ink)}
        .nav-links a:hover::after{transform:scaleX(1)}
        .nav-cta{margin-left:auto}

        /* ============ hero ============ */
        .hero{padding:168px 0 100px}
        .hero-inner{display:grid;grid-template-columns:1.02fr .98fr;gap:64px;align-items:center}
        .eyebrow{display:inline-flex;align-items:center;gap:10px;font:500 12px var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--ink-2)}
        .live-dot{width:7px;height:7px;border-radius:50%;background:var(--sage);position:relative;flex:none}
        .live-dot::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:1px solid var(--sage);opacity:0;animation:ping 2.8s ease-out infinite}
        @keyframes ping{0%{transform:scale(.5);opacity:.7}70%{transform:scale(1.4);opacity:0}100%{opacity:0}}
        .hero-title{font-size:clamp(2.7rem,4.9vw,4.3rem);line-height:1.04;letter-spacing:-.02em;margin-top:26px}
        .hero-sub{margin-top:26px;max-width:520px;font-size:17.5px;line-height:1.65;color:var(--ink-2)}
        .hero-actions{display:flex;align-items:center;gap:16px;margin-top:40px;flex-wrap:wrap}
        .hero-note{display:flex;align-items:center;gap:8px;margin-top:26px;font:400 12px var(--mono);color:var(--ink-3)}
        .hero-note svg{width:14px;height:14px;color:var(--sage);flex:none}

        /* ---- hero visualization ---- */
        .hero-viz svg{width:100%;height:auto;max-width:620px;margin-left:auto}
        .viz-node,.viz-chip{transform-box:fill-box;transform-origin:center}
        .viz-node{opacity:0;animation:viz-rise .9s cubic-bezier(.2,.6,.2,1) var(--d,0s) forwards}
        .viz-chip{opacity:0;animation:viz-rise .9s cubic-bezier(.2,.6,.2,1) var(--d,0s) forwards}
        @keyframes viz-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .viz-node rect{fill:#FCFBF6;stroke:#DFDACA;stroke-width:1;transition:stroke .3s}
        .viz-node:hover rect{stroke:#A9B295}
        .viz-node text{pointer-events:none}
        .viz-node-name{font:500 13px var(--mono);fill:#262A22}
        .viz-node-meta{font:400 10.5px var(--mono);fill:#8B8F82}
        .viz-fileicon{stroke:#7E8A6E;fill:none;stroke-width:1.2;stroke-linejoin:round}
        .viz-path{fill:none;stroke:#C6CBB4;stroke-width:1.2;stroke-dasharray:1;stroke-dashoffset:1;animation:viz-draw 1.5s cubic-bezier(.4,0,.2,1) var(--d,.5s) forwards}
        .viz-path[data-flow="out"]{stroke:#B4BC9F}
        @keyframes viz-draw{to{stroke-dashoffset:0}}
        .viz-hub{opacity:0;animation:viz-fade 1.2s ease .7s forwards}
        @keyframes viz-fade{to{opacity:1}}
        .hub-ring{fill:none;stroke:#C7CDB8;stroke-width:1.2}
        .hub-dashed{fill:none;stroke:#9AA98B;stroke-width:1;stroke-dasharray:2 7;stroke-linecap:round}
        .hub-core{fill:#EDF0E4;stroke:#B9C4A8;stroke-width:1}
        .hub-mark line{stroke:#38483A;stroke-width:1;opacity:.5}
        .hub-mark circle{fill:#38483A}
        .viz-col-label{font:500 10px var(--mono);fill:#9A9E8F;letter-spacing:.16em}
        .viz-chip rect{fill:#FCFBF6;stroke:#DFDACA;stroke-width:1;transition:stroke .3s,fill .3s}
        .viz-chip:hover rect{stroke:#9AA98B;fill:#FFFFFF}
        .viz-chip text{pointer-events:none}
        .viz-chip-label{font:500 9.5px var(--mono);fill:#8B8F82;letter-spacing:.12em}
        .viz-chip-value{font:500 12px var(--sans);fill:#262A22}
        .viz-chipicon{stroke:var(--sage);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
        .viz-status{font:400 10.5px var(--mono);fill:#8B8F82;transition:opacity .4s ease}

        /* ============ sections ============ */
        .section{padding:132px 0;border-top:1px solid var(--line)}
        .kicker{font:500 12px var(--mono);letter-spacing:.18em;text-transform:uppercase;color:#6B7A5E}
        .section-head h2{font-size:clamp(2.1rem,3.6vw,3rem);line-height:1.12;margin-top:20px;max-width:640px}
        .lede{margin-top:22px;max-width:620px;font-size:17px;line-height:1.68;color:var(--ink-2)}

        /* reveal */
        [data-reveal]{opacity:0;transform:translateY(22px);transition:opacity .8s cubic-bezier(.2,.6,.2,1),transform .8s cubic-bezier(.2,.6,.2,1)}
        [data-reveal].in{opacity:1;transform:none}

        /* ============ workspace panel ============ */
        .workspace{margin-top:64px;border:1px solid var(--line);border-radius:18px;background:var(--surface);overflow:hidden;box-shadow:0 1px 2px rgba(31,35,29,.04),0 28px 56px -38px rgba(31,35,29,.22)}
        .workspace-bar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 22px;border-bottom:1px solid var(--line);font:500 11px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
        .workspace-bar span{display:inline-flex;align-items:center;gap:9px}
        .workspace-bar svg{width:14px;height:14px;color:var(--sage)}
        .workspace-body{display:grid;grid-template-columns:320px 1fr;min-height:392px}
        .dataset-list{list-style:none;border-right:1px solid var(--line);padding:12px}
        .dataset-row{display:grid;grid-template-columns:18px 1fr 14px;gap:12px;align-items:center;padding:14px;border-radius:10px;cursor:pointer;transition:background .2s ease;position:relative}
        .dataset-row:hover{background:#F1EFE4}
        .dataset-row.active{background:#ECF0E2}
        .dataset-row.active::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:2.5px;border-radius:2px;background:var(--sage)}
        .dr-ic{width:16px;height:18px;color:var(--ink-3)}
        .dataset-row.active .dr-ic{color:var(--sage-deep)}
        .dr-meta{display:flex;flex-direction:column;gap:3px;min-width:0}
        .dr-name{font:500 13px var(--mono);color:var(--ink)}
        .dr-sub{font:400 11px var(--mono);color:var(--ink-3)}
        .dr-arrow{width:13px;height:13px;color:var(--sage-deep);opacity:0;transition:opacity .2s,transform .2s}
        .dataset-row.active .dr-arrow,.dataset-row:hover .dr-arrow{opacity:1}
        .dataset-row.active .dr-arrow{transform:translateX(2px)}
        .dataset-detail{padding:34px 38px;display:flex;flex-direction:column;justify-content:center}
        .dd-inner{opacity:0;transform:translateY(8px);transition:opacity .35s ease,transform .35s ease}
        .dd-inner.in{opacity:1;transform:none}
        .dd-kicker{display:flex;align-items:center;gap:8px;font:500 11px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
        .dd-kicker svg{width:13px;height:13px;color:var(--sage)}
        .dd-name{font-size:26px;margin-top:12px}
        .dd-note{margin-top:14px;font-size:14.5px;line-height:1.6;color:var(--ink-2);border-left:2px solid var(--sage-mid);padding-left:14px;max-width:560px}
        .col-chips{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}
        .col-chip{display:inline-flex;align-items:center;gap:9px;border:1px solid var(--line);background:var(--surface-2);border-radius:8px;padding:7px 11px}
        .col-name{font:500 12.5px var(--mono);color:var(--ink)}
        .col-type{font:500 9.5px var(--mono);letter-spacing:.08em;text-transform:uppercase;border-radius:5px;padding:3px 6px}
        .type-id,.type-ref{color:#4E6242;background:#E8EDDA}
        .type-money{color:#8A5A22;background:#F4EAD8}
        .type-date,.type-enum{color:#7C6C3B;background:#F0EBDA}
        .type-number,.type-text{color:#6E7365;background:#EEEBE1}
        .dd-foot{display:flex;align-items:center;gap:8px;margin-top:26px;font:400 11.5px var(--mono);color:var(--ink-3)}
        .dd-foot svg{width:13px;height:13px;color:var(--sage);flex:none}

        /* ============ intelligence ============ */
        .intel-grid{display:grid;grid-template-columns:.82fr 1.18fr;gap:84px;align-items:start;margin-top:72px}
        .intel-left{position:sticky;top:110px}
        .looks-for{list-style:none;margin-top:36px}
        .looks-for li{padding:19px 0;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:5px;transition:padding-left .3s ease}
        .looks-for li:last-child{border-bottom:1px solid var(--line)}
        .looks-for li:hover{padding-left:8px}
        .lf-name{font:500 15.5px var(--sans);color:var(--ink)}
        .lf-desc{font:400 12px var(--mono);color:var(--ink-3)}
        .findings-head{display:flex;justify-content:space-between;align-items:center;padding-bottom:16px;border-bottom:1px solid var(--line);font:500 11px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
        .finding{display:grid;grid-template-columns:1fr 176px;gap:30px;padding:32px 0;border-bottom:1px solid var(--line)}
        .finding-head{display:flex;align-items:center;gap:12px;margin-bottom:14px}
        .f-tag{font:500 10px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--sage-deep);background:var(--sage-pale);border-radius:6px;padding:5px 9px}
        .f-metric{margin-left:auto;font:500 12px var(--mono);color:var(--sage-deep)}
        .finding h3{font-size:20.5px;line-height:1.32}
        .finding-detail{margin-top:12px;font-size:14.5px;line-height:1.62;color:var(--ink-2)}
        .chart-box{border:1px solid var(--line);border-radius:12px;background:var(--surface-2);padding:12px 12px 10px;align-self:start}
        .chart-box svg{width:100%;height:auto}
        .chart-caption{margin-top:8px;font:400 9.5px var(--mono);color:var(--ink-3);letter-spacing:.04em}

        /* ============ workflow ============ */
        .steps{position:relative;margin-top:72px}
        .steps-track{position:absolute;left:47px;top:40px;bottom:60px;width:2px;background:#E4E0D4;border-radius:2px}
        .steps-fill{position:absolute;top:0;left:0;width:100%;height:0;background:var(--sage);border-radius:2px}
        .step{display:grid;grid-template-columns:96px 1fr 350px;gap:46px;padding:56px 0;align-items:start}
        .step + .step{border-top:1px solid var(--line)}
        .step-num span{display:block;text-align:center;font:600 64px/1 var(--serif);color:transparent;-webkit-text-stroke:1.2px #A7B295;transition:color .6s ease,-webkit-text-stroke-color .6s ease}
        .step.passed .step-num span{color:#41543F;-webkit-text-stroke-color:#41543F}
        .step-content h3{font-size:27px}
        .step-content p{margin-top:16px;font-size:15.5px;line-height:1.68;color:var(--ink-2);max-width:430px}
        .step-visual{border:1px solid var(--line);border-radius:14px;background:var(--surface);padding:22px}
        /* step 1 */
        .sv-upload{display:flex;align-items:center;gap:16px}
        .drop-tile{width:64px;height:64px;flex:none;border:1.5px dashed #C6C0AC;border-radius:12px;display:grid;place-items:center;color:#8B8F7C}
        .drop-tile svg{width:22px;height:22px}
        .file-chip{display:flex;align-items:center;gap:12px;min-width:0}
        .file-chip .fc-ic{width:17px;height:20px;color:var(--sage);flex:none}
        .fc-meta{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
        .fc-name{font:500 13px var(--mono);color:var(--ink)}
        .fc-sub{font:400 10.5px var(--mono);color:var(--ink-3)}
        .fc-bar{display:block;height:4px;border-radius:4px;background:#EDE9DC;margin-top:5px;overflow:hidden}
        .fc-bar span{display:block;height:100%;width:100%;border-radius:4px;background:var(--sage)}
        .file-chip .fc-check{width:15px;height:15px;color:var(--sage);flex:none}
        /* step 2 */
        .sv-parse{list-style:none;display:flex;flex-direction:column;gap:14px}
        .sv-parse li{display:flex;align-items:center;gap:11px;font:400 12.5px var(--mono);color:var(--ink-2);opacity:0;transform:translateY(6px);transition:opacity .5s ease,transform .5s ease}
        .step.in .sv-parse li{opacity:1;transform:none}
        .step.in .sv-parse li:nth-child(1){transition-delay:.25s}
        .step.in .sv-parse li:nth-child(2){transition-delay:.55s}
        .step.in .sv-parse li:nth-child(3){transition-delay:.85s}
        .status-dot{width:17px;height:17px;flex:none;border-radius:50%;background:var(--sage-pale);display:grid;place-items:center;color:var(--sage-deep)}
        .status-dot svg{width:9px;height:9px}
        .sv-parse em{font-style:normal;color:var(--sage-deep)}
        /* step 3 */
        .sv-qa{display:flex;flex-direction:column;gap:14px}
        .qa{display:flex;gap:11px;align-items:flex-start}
        .qa-mark{flex:none;width:27px;height:27px;border-radius:50%;display:grid;place-items:center;font:500 9.5px var(--mono);letter-spacing:.05em}
        .qa.q .qa-mark{border:1px solid var(--line-2);color:var(--ink-2);background:var(--surface-2)}
        .qa.a .qa-mark{background:var(--sage-deep);color:#F1EFE5}
        .qa p{font-size:14px;line-height:1.55;color:var(--ink-2)}
        .qa.a p{color:var(--ink)}
        .qa.a strong{font-weight:600;color:var(--sage-deep)}
        .caret{display:inline-block;width:7px;height:13px;background:var(--sage);margin-left:3px;vertical-align:-1px;animation:blink 1.3s steps(1) infinite}
        @keyframes blink{50%{opacity:0}}

        /* ============ final + footer ============ */
        .final{background:#242B22;color:#F1EFE5;padding:150px 0 0}
        .final-inner{text-align:center;display:flex;flex-direction:column;align-items:center}
        .flowline{display:flex;align-items:center;gap:14px;font:500 11px var(--mono);letter-spacing:.16em;text-transform:uppercase;color:#9FAB90}
        .flowline svg{width:14px;height:14px;color:#9FAB90}
        .final-title{margin-top:38px;font-size:clamp(2.4rem,4.6vw,3.7rem);line-height:1.1;color:#F5F3E9;max-width:760px}
        .final-title em{color:#B9C7A6}
        .final-sub{margin-top:24px;font-size:16.5px;line-height:1.6;color:#B8BFAE;max-width:460px}
        .final .btn-primary{background:#F1EFE5;color:#23301F;margin-top:42px}
        .final .btn-primary:hover{background:#FFFFFF}
        .final-note{display:flex;align-items:center;gap:8px;margin-top:24px;font:400 12px var(--mono);color:#7E876F}
        .final-note svg{width:13px;height:13px;color:#9FAB90;flex:none}
        .footer{margin-top:120px;border-top:1px solid rgba(240,238,228,.14);padding:32px 0}
        .footer-inner{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
        .footer .brand{color:#EDEBDF}
        .footer-right{font:400 11.5px var(--mono);color:#7E876F}

        @media (max-width:1000px){
          .hero{padding:140px 0 70px}
          .hero-inner{grid-template-columns:1fr;gap:52px}
          .hero-viz{width:100vw;margin-left:calc(50% - 50vw);display:flex;justify-content:center;padding:14px 0 6px}
          .hero-viz svg{max-width:640px;margin:0}
          .intel-grid{grid-template-columns:1fr;gap:52px}
          .intel-left{position:static}
          .step{grid-template-columns:1fr;gap:20px;padding:44px 0}
          .step-num span{text-align:left;font-size:46px;-webkit-text-stroke-width:1px}
          .steps-track{display:none}
          .step-content p{max-width:600px}
        }
        @media (max-width:840px){
          .workspace-body{grid-template-columns:1fr}
          .dataset-list{display:flex;overflow-x:auto;border-right:none;border-bottom:1px solid var(--line);gap:6px;padding-bottom:12px}
          .dataset-row{flex:none;min-width:212px;grid-template-columns:16px 1fr 13px;padding:13px 14px}
          .dataset-detail{padding:28px 24px}
          .finding{grid-template-columns:1fr;gap:20px}
          .section{padding:92px 0}
          .final{padding:104px 0 0}
        }
        @media (max-width:700px){
          .nav-links{display:none}
          .viz-node-meta,.viz-status{display:none}
          .hero{padding:126px 0 56px}
          .container{padding:0 24px}
          .nav-inner{padding:16px 24px}
        }
        @media (prefers-reduced-motion:reduce){
          *,*::before,*::after{animation-duration:.001s !important;animation-iteration-count:1 !important;transition-duration:.001s !important}
          html{scroll-behavior:auto}
          [data-reveal]{opacity:1;transform:none}
        }
      `}} />

      {/* ================= NAV ================= */}
      <header className={`nav ${scrolled ? 'scrolled' : ''}`} id="nav">
        <div className="nav-inner">
          <a className="brand" href="#top" aria-label="HelperX home">
            <svg className="brand-mark" viewBox="0 0 26 26" aria-hidden="true">
              <circle cx="13" cy="13" r="11.2" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".5"/>
              <path d="M13 6.6 7.4 16.2M13 6.6l5.6 9.6M7.4 16.2h11.2" stroke="currentColor" strokeWidth="1.1" fill="none" opacity=".8"/>
              <circle cx="13" cy="6.6" r="2.1" fill="currentColor"/><circle cx="7.4" cy="16.2" r="2.1" fill="currentColor"/><circle cx="18.6" cy="16.2" r="2.1" fill="currentColor"/>
            </svg>
            <span className="brand-name">HelperX</span>
          </a>
          <nav className="nav-links" aria-label="Main">
            <a href="#data">Data</a>
            <a href="#intelligence">Intelligence</a>
            <a href="#workflow">How it works</a>
          </nav>
          <button className="btn btn-primary btn-small nav-cta" onClick={() => router.push("/upload")}>Get Started</button>
        </div>
      </header>

      {/* ================= HERO ================= */}
      <section className="hero" id="top">
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="eyebrow"><span className="live-dot" aria-hidden="true"></span>AI merchant intelligence</p>
            <h1 className="hero-title">Your AI Merchant<br /><em>Growth</em> Strategist</h1>
            <p className="hero-sub">Turn your business data into clear insights and actionable growth opportunities. Upload the CSVs you already export — orders, customers, products — and let HelperX understand what they mean.</p>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={() => router.push("/upload")}>Get Started
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 8h11m0 0L9 3.5M13.5 8 9 12.5"/></svg>
              </button>
              <a className="btn btn-ghost" href="#workflow">See how it works</a>
            </div>
            <p className="hero-note">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>
              No complex setup — start with a single CSV.
            </p>
          </div>

          {/* hero visualization : data → understanding → decisions */}
          <div className="hero-viz" aria-hidden="true">
            <svg ref={heroVizRef} id="heroViz" viewBox="0 0 640 560" role="img">
              {/* backdrop */}
              <circle cx="340" cy="258" r="152" fill="#ECEEE3" opacity=".55"/>
              <circle cx="340" cy="258" r="196" fill="none" stroke="#E4E5D7" strokeWidth="1"/>
              {/* column labels */}
              <text x="20" y="58" className="viz-col-label">BUSINESS DATA</text>
              <text x="340" y="176" textAnchor="middle" className="viz-col-label">AI UNDERSTANDING</text>
              <text x="452" y="58" className="viz-col-label">GROWTH DECISIONS</text>

              {/* flows in */}
              <g>
                <path id="in1" className="viz-path" pathLength={1} style={{ '--d': '.55s' } as React.CSSProperties} data-flow="in" d="M178,101 C244,101 214,258 282,258"/>
                <path id="in2" className="viz-path" pathLength={1} style={{ '--d': '.7s' } as React.CSSProperties} data-flow="in" d="M178,171 C238,171 216,258 282,258"/>
                <path id="in3" className="viz-path" pathLength={1} style={{ '--d': '.85s' } as React.CSSProperties} data-flow="in" d="M178,241 C232,241 218,258 282,258"/>
                <path id="in4" className="viz-path" pathLength={1} style={{ '--d': '1s' } as React.CSSProperties} data-flow="in" d="M178,311 C238,311 216,258 282,258"/>
                <path id="in5" className="viz-path" pathLength={1} style={{ '--d': '1.15s' } as React.CSSProperties} data-flow="in" d="M178,381 C244,381 214,258 282,258"/>
              </g>

              {/* hub */}
              <g className="viz-hub">
                <circle cx="340" cy="258" r="58" className="hub-ring"/>
                <circle cx="340" cy="258" r="46" className="hub-dashed">
                  <animateTransform attributeName="transform" type="rotate" from="0 340 258" to="360 340 258" dur="64s" repeatCount="indefinite"/>
                </circle>
                <circle cx="340" cy="258" r="30" className="hub-core">
                  <animate attributeName="r" values="30;32.5;30" dur="6s" repeatCount="indefinite"/>
                </circle>
                <g className="hub-mark">
                  <line x1="340" y1="246" x2="330" y2="263"/><line x1="340" y1="246" x2="350" y2="263"/><line x1="330" y1="263" x2="350" y2="263"/>
                  <circle cx="340" cy="246" r="2.6"/><circle cx="330" cy="263" r="2.6"/><circle cx="350" cy="263" r="2.6"/>
                </g>
                <text x="340" y="344" textAnchor="middle" className="viz-status" id="hubStatus">{hubStatus}</text>
              </g>

              {/* flows out */}
              <g>
                <path id="out1" className="viz-path" pathLength={1} style={{ '--d': '1.3s' } as React.CSSProperties} data-flow="out" d="M398,258 C428,258 420,166 452,166"/>
                <path id="out2" className="viz-path" pathLength={1} style={{ '--d': '1.4s' } as React.CSSProperties} data-flow="out" d="M398,258 C420,258 430,258 452,258"/>
                <path id="out3" className="viz-path" pathLength={1} style={{ '--d': '1.5s' } as React.CSSProperties} data-flow="out" d="M398,258 C428,258 420,350 452,350"/>
              </g>

              {/* dataset nodes */}
              <g className="viz-node" style={{ '--d': '.15s' } as React.CSSProperties}>
                <rect x="20" y="78" width="158" height="46" rx="10"/>
                <g className="viz-fileicon" transform="translate(34,89)"><path d="M2 1.5h5.5L11 5v8.5H2z"/><path d="M7.5 1.5V5H11"/></g>
                <text x="58" y="98" className="viz-node-name">orders.csv</text>
                <text x="58" y="112" className="viz-node-meta">12,438 rows</text>
              </g>
              <g className="viz-node" style={{ '--d': '.28s' } as React.CSSProperties}>
                <rect x="20" y="148" width="158" height="46" rx="10"/>
                <g className="viz-fileicon" transform="translate(34,159)"><path d="M2 1.5h5.5L11 5v8.5H2z"/><path d="M7.5 1.5V5H11"/></g>
                <text x="58" y="168" className="viz-node-name">customers.csv</text>
                <text x="58" y="182" className="viz-node-meta">3,109 rows</text>
              </g>
              <g className="viz-node" style={{ '--d': '.41s' } as React.CSSProperties}>
                <rect x="20" y="218" width="158" height="46" rx="10"/>
                <g className="viz-fileicon" transform="translate(34,229)"><path d="M2 1.5h5.5L11 5v8.5H2z"/><path d="M7.5 1.5V5H11"/></g>
                <text x="58" y="238" className="viz-node-name">products.csv</text>
                <text x="58" y="252" className="viz-node-meta">486 rows</text>
              </g>
              <g className="viz-node" style={{ '--d': '.54s' } as React.CSSProperties}>
                <rect x="20" y="288" width="158" height="46" rx="10"/>
                <g className="viz-fileicon" transform="translate(34,299)"><path d="M2 1.5h5.5L11 5v8.5H2z"/><path d="M7.5 1.5V5H11"/></g>
                <text x="58" y="308" className="viz-node-name">transactions.csv</text>
                <text x="58" y="322" className="viz-node-meta">30,204 rows</text>
              </g>
              <g className="viz-node" style={{ '--d': '.67s' } as React.CSSProperties}>
                <rect x="20" y="358" width="158" height="46" rx="10"/>
                <g className="viz-fileicon" transform="translate(34,369)"><path d="M2 1.5h5.5L11 5v8.5H2z"/><path d="M7.5 1.5V5H11"/></g>
                <text x="58" y="378" className="viz-node-name">returns.csv</text>
                <text x="58" y="392" className="viz-node-meta">612 rows</text>
              </g>

              {/* insight chips */}
              <g className="viz-chip" style={{ '--d': '1.75s' } as React.CSSProperties}>
                <rect x="452" y="136" width="170" height="60" rx="12"/>
                <g className="viz-chipicon" transform="translate(466,158)"><path d="M2 12 7 7l3 3 5-6M11 4h4v4"/></g>
                <text x="492" y="161" className="viz-chip-label">SALES TREND</text>
                <text x="492" y="178" className="viz-chip-value">Revenue +14% QoQ</text>
              </g>
              <g className="viz-chip" style={{ '--d': '2s' } as React.CSSProperties}>
                <rect x="452" y="228" width="170" height="60" rx="12"/>
                <g className="viz-chipicon" transform="translate(466,250)"><circle cx="4.5" cy="8" r="3"/><circle cx="11.5" cy="8" r="3"/><path d="M7.5 8h1"/></g>
                <text x="492" y="253" className="viz-chip-label">CROSS-SELL</text>
                <text x="492" y="270" className="viz-chip-value">Desk Mat → Cable Kit</text>
              </g>
              <g className="viz-chip" style={{ '--d': '2.25s' } as React.CSSProperties}>
                <rect x="452" y="320" width="170" height="60" rx="12"/>
                <g className="viz-chipicon" transform="translate(466,342)"><circle cx="8" cy="5" r="3"/><path d="M2.5 15c.8-3.4 3-5 5.5-5s4.7 1.6 5.5 5"/></g>
                <text x="492" y="345" className="viz-chip-label">WIN-BACK</text>
                <text x="492" y="362" className="viz-chip-value">1,240 dormant buyers</text>
              </g>
            </svg>
          </div>
        </div>
      </section>

      {/* ================= DATA UNDERSTANDING ================= */}
      <section className="section" id="data">
        <div className="container">
          <div className="section-head" data-reveal>
            <p className="kicker">01 · Data understanding</p>
            <h2>It starts by <em>understanding</em> your data.</h2>
            <p className="lede">HelperX works with the business datasets you already have. Bring the files you export today — no cleaning, no schema setup, no data team. The system profiles each dataset on arrival, infers what every column means, and links them into one connected picture of your business.</p>
          </div>

          <div className="workspace" id="workspace" ref={workspaceRef} data-reveal style={{ transitionDelay: '.15s' }}>
            <div className="workspace-bar">
              <span>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true"><path d="M1.8 3.8h4.4l1.4 1.9h6.6V12.5H1.8z"/></svg>
                Workspace · datasets
              </span>
              <span>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M6 10.5 10 6.5M4.2 8.4 2.9 9.7a2.3 2.3 0 0 0 3.3 3.3l1.2-1.3M11.8 7.6l1.3-1.3a2.3 2.3 0 0 0-3.3-3.3L8.6 4.3"/></svg>
                5 files · auto-linked
              </span>
            </div>
            <div className="workspace-body">
              <ul className="dataset-list" id="datasetList">
                {DATASETS.map((d, i) => (
                  <li 
                    key={d.name}
                    className={`dataset-row ${i === dsIndex ? 'active' : ''}`}
                    onClick={() => selectDataset(i, true)}
                    tabIndex={0}
                    role="button"
                    aria-label={`Inspect ${d.name}`}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectDataset(i, true); }}}
                  >
                    <svg className="dr-ic" viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"><path d="M1.5 1.5h7L12.5 5.5v9h-11z"/><path d="M8.5 1.5v4h4"/></svg>
                    <div className="dr-meta">
                      <span className="dr-name">{d.name}</span>
                      <span className="dr-sub">{d.rows} rows · {d.columns.length} columns</span>
                    </div>
                    <svg className="dr-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>
                  </li>
                ))}
              </ul>
              <div className="dataset-detail" id="datasetDetail">
                <div className={`dd-inner ${dsInnerVisible ? 'in' : ''}`}>
                  <p className="dd-kicker">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="6" cy="6" r="2.6"/><circle cx="10" cy="10" r="2.6"/><path d="M8 8l2.2 2.2" transform="translate(-3.2 -3.2)"/></svg>
                    Detected structure
                  </p>
                  <h3 className="dd-name">{DATASETS[dsIndex].name}</h3>
                  <p className="dd-note">{DATASETS[dsIndex].note}</p>
                  <ul className="col-chips">
                    {DATASETS[dsIndex].columns.map((c) => (
                      <li key={c[0]} className="col-chip">
                        <span className="col-name">{c[0]}</span>
                        <span className={`col-type type-${c[1]}`}>{c[1]}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="dd-foot">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>
                    Understood automatically — no schema mapping required.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= INTELLIGENCE ================= */}
      <section className="section" id="intelligence">
        <div className="container">
          <div className="section-head" data-reveal>
            <p className="kicker">02 · Intelligence</p>
            <h2>Not another dashboard.</h2>
            <p className="lede">Dashboards display your data — HelperX understands it. It learns how your datasets relate, where the patterns hide, and which of them are worth money. Then it tells you, like a good analyst would.</p>
          </div>

          <div className="intel-grid">
            <div className="intel-left" data-reveal>
              <p className="kicker" style={{ color: 'var(--ink-3)' }}>What it looks for</p>
              <ul className="looks-for">
                <li><span className="lf-name">Sales trends</span><span className="lf-desc">seasonality · momentum · promo lift</span></li>
                <li><span className="lf-name">Customer behavior</span><span className="lf-desc">cohorts · reorder cycles · churn signals</span></li>
                <li><span className="lf-name">Product performance</span><span className="lf-desc">margin contribution · slow movers · return risk</span></li>
                <li><span className="lf-name">Revenue opportunities</span><span className="lf-desc">pricing gaps · bundles · dormant segments</span></li>
                <li><span className="lf-name">Cross-sell &amp; upsell</span><span className="lf-desc">natural pairings · upgrade triggers · timing</span></li>
              </ul>
            </div>

            <div>
              <div className="findings-head" data-reveal>
                <span>Findings</span><span>sample workspace · auto-generated</span>
              </div>

              <article className="finding" data-reveal>
                <div>
                  <div className="finding-head"><span className="f-tag">Sales trends</span><span className="f-metric">+14% QoQ</span></div>
                  <h3>Revenue is up 14% quarter over quarter — and three promo windows account for most of the lift.</h3>
                  <p className="finding-detail">Momentum is real, but it's promotion-shaped. Extend the winning window; retire the other two.</p>
                </div>
                <div className="chart-box">
                  <svg viewBox="0 0 150 64" aria-hidden="true">
                    <path d="M3 50 20 46 36 48 52 34 68 38 86 22 102 28 120 12 147 8 147 62 3 62Z" fill="#ECEEE0"/>
                    <path d="M3 50 20 46 36 48 52 34 68 38 86 22 102 28 120 12 147 8" fill="none" stroke="#5F7355" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"/>
                    <circle cx="52" cy="34" r="2" fill="#5F7355"/><circle cx="86" cy="22" r="2" fill="#5F7355"/><circle cx="120" cy="12" r="2" fill="#5F7355"/>
                    <path d="M52 56v6M86 56v6M120 56v6" stroke="#B9834F" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                  <p className="chart-caption">weekly revenue · ticks mark promo windows</p>
                </div>
              </article>

              <article className="finding" data-reveal>
                <div>
                  <div className="finding-head"><span className="f-tag">Customer behavior</span><span className="f-metric">68% in 45d</span></div>
                  <h3>68% of your repeat buyers reorder within 45 days.</h3>
                  <p className="finding-detail">That's a natural reminder window — a gentle nudge on day 30 is timed to how your customers already behave.</p>
                </div>
                <div className="chart-box">
                  <svg viewBox="0 0 150 72" aria-hidden="true">
                    <rect x="6" y="48" width="14" height="10" rx="2" fill="#CBD3BA"/>
                    <rect x="30" y="36" width="14" height="22" rx="2" fill="#CBD3BA"/>
                    <rect x="54" y="28" width="14" height="30" rx="2" fill="#5F7355"/>
                    <rect x="78" y="42" width="14" height="16" rx="2" fill="#CBD3BA"/>
                    <rect x="102" y="49" width="14" height="9" rx="2" fill="#CBD3BA"/>
                    <rect x="126" y="53" width="14" height="5" rx="2" fill="#CBD3BA"/>
                    <text x="13" y="68" textAnchor="middle" fontSize="7.5" fill="#8B8F82" fontFamily="Spline Sans Mono,monospace">15</text>
                    <text x="37" y="68" textAnchor="middle" fontSize="7.5" fill="#8B8F82" fontFamily="Spline Sans Mono,monospace">30</text>
                    <text x="61" y="68" textAnchor="middle" fontSize="7.5" fill="#5F7355" fontFamily="Spline Sans Mono,monospace">45</text>
                    <text x="85" y="68" textAnchor="middle" fontSize="7.5" fill="#8B8F82" fontFamily="Spline Sans Mono,monospace">60</text>
                    <text x="109" y="68" textAnchor="middle" fontSize="7.5" fill="#8B8F82" fontFamily="Spline Sans Mono,monospace">75</text>
                    <text x="133" y="68" textAnchor="middle" fontSize="7.5" fill="#8B8F82" fontFamily="Spline Sans Mono,monospace">90</text>
                  </svg>
                  <p className="chart-caption">days between first and second order</p>
                </div>
              </article>

              <article className="finding" data-reveal>
                <div>
                  <div className="finding-head"><span className="f-tag">Product performance</span><span className="f-metric">top 10 = 61%</span></div>
                  <h3>Your top 10 products drive 61% of margin. Four SKUs are quietly eroding it.</h3>
                  <p className="finding-detail">High return rates on two of them point to a sizing or expectation issue worth fixing before the next season.</p>
                </div>
                <div className="chart-box">
                  <svg viewBox="0 0 150 72" aria-hidden="true">
                    <path d="M36 4v64" stroke="#DDD8C8" strokeWidth="1"/>
                    <rect x="36" y="7" width="106" height="5" rx="2.5" fill="#5F7355"/>
                    <rect x="36" y="15" width="88" height="5" rx="2.5" fill="#5F7355"/>
                    <rect x="36" y="23" width="72" height="5" rx="2.5" fill="#5F7355"/>
                    <rect x="36" y="31" width="58" height="5" rx="2.5" fill="#A9B696"/>
                    <rect x="36" y="39" width="40" height="5" rx="2.5" fill="#A9B696"/>
                    <rect x="36" y="47" width="22" height="5" rx="2.5" fill="#A9B696"/>
                    <rect x="20" y="55" width="16" height="5" rx="2.5" fill="#C08A4E"/>
                    <rect x="25" y="63" width="11" height="5" rx="2.5" fill="#C08A4E"/>
                  </svg>
                  <p className="chart-caption">margin contribution by SKU · 2 negative</p>
                </div>
              </article>

              <article className="finding" data-reveal>
                <div>
                  <div className="finding-head"><span className="f-tag">Revenue opportunity</span><span className="f-metric">1,240 profiles</span></div>
                  <h3>A dormant cohort of 1,240 customers closely matches your best segment's profile.</h3>
                  <p className="finding-detail">A win-back offer shaped on lookalike signals — not a blanket discount to people who were never going to buy.</p>
                </div>
                <div className="chart-box">
                  <svg viewBox="0 0 150 72" aria-hidden="true">
                    {Array.from({ length: 5 }).map((_, r) =>
                      Array.from({ length: 12 }).map((_, cIdx) => (
                        <circle
                          key={`dm-${r}-${cIdx}`}
                          cx={8 + cIdx * 12.2}
                          cy={10 + r * 13}
                          r={3}
                          fill={r === 4 ? '#5F7355' : '#D6D2C4'}
                        />
                      ))
                    )}
                  </svg>
                  <p className="chart-caption">6,208 customers · highlighted = dormant matches</p>
                </div>
              </article>

              <article className="finding" data-reveal>
                <div>
                  <div className="finding-head"><span className="f-tag">Cross-sell &amp; upsell</span><span className="f-metric">2.3× pairing</span></div>
                  <h3>Customers who buy the Desk Mat add the Cable Kit 2.3× more often than chance.</h3>
                  <p className="finding-detail">A checkout bundle would simply formalize a pairing your customers already prefer.</p>
                </div>
                <div className="chart-box">
                  <svg viewBox="0 0 150 72" aria-hidden="true">
                    <circle cx="42" cy="32" r="19" fill="#ECEEE0" stroke="#5F7355" strokeWidth="1.4"/>
                    <circle cx="108" cy="32" r="19" fill="#F1F2E9" stroke="#8FA07E" strokeWidth="1.4"/>
                    <path d="M61 32h28" stroke="#5F7355" strokeWidth="1.2" strokeDasharray="2 3"/>
                    <rect x="62" y="23" width="26" height="17" rx="8.5" fill="#33463A"/>
                    <text x="75" y="35" textAnchor="middle" fontSize="9" fill="#F1EFE5" fontFamily="Spline Sans Mono,monospace">2.3×</text>
                    <text x="42" y="62" textAnchor="middle" fontSize="7.5" fill="#8B8F82" fontFamily="Spline Sans Mono,monospace">Desk mat</text>
                    <text x="108" y="62" textAnchor="middle" fontSize="7.5" fill="#8B8F82" fontFamily="Spline Sans Mono,monospace">Cable kit</text>
                  </svg>
                  <p className="chart-caption">co-purchase lift vs. random pairing</p>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>

      {/* ================= WORKFLOW ================= */}
      <section className="section" id="workflow">
        <div className="container">
          <div className="section-head" data-reveal>
            <p className="kicker">03 · Workflow</p>
            <h2>From CSV to growth decisions, <em>in three steps.</em></h2>
          </div>

          <div className="steps" id="steps" ref={stepsRef}>
            <div className="steps-track"><div className="steps-fill" id="stepsFill" ref={stepsFillRef}></div></div>

            <article className="step" data-reveal>
              <div className="step-num"><span>01</span></div>
              <div className="step-content">
                <h3>Upload your data</h3>
                <p>Drop in the files you already export from your store, ERP, or spreadsheet. One CSV is enough to start — a handful is better. No cleaning, no formatting, no setup.</p>
              </div>
              <div className="step-visual sv-upload">
                <div className="drop-tile" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V5m0 0-4 4m4-4 4 4M4.5 19.5h15"/></svg>
                </div>
                <div className="file-chip">
                  <svg className="fc-ic" viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"><path d="M1.5 1.5h7L12.5 5.5v9h-11z"/><path d="M8.5 1.5v4h4"/></svg>
                  <div className="fc-meta">
                    <span className="fc-name">orders.csv</span>
                    <span className="fc-sub">uploaded · 12,438 rows</span>
                    <span className="fc-bar"><span></span></span>
                  </div>
                  <svg className="fc-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>
                </div>
              </div>
            </article>

            <article className="step" data-reveal>
              <div className="step-num"><span>02</span></div>
              <div className="step-content">
                <h3>Let HelperX understand it</h3>
                <p>The system profiles each dataset on arrival: what the columns mean, how they join, what they say about your business. Minutes, not weeks — and no data team required.</p>
              </div>
              <div className="step-visual">
                <ul className="sv-parse">
                  <li><span className="status-dot"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg></span>6 columns detected — types inferred</li>
                  <li><span className="status-dot"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg></span><em>total</em>, <em>items</em> read as money &amp; count</li>
                  <li><span className="status-dot"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg></span><em>customer_id</em> linked → customers.csv</li>
                </ul>
              </div>
            </article>

            <article className="step" data-reveal>
              <div className="step-num"><span>03</span></div>
              <div className="step-content">
                <h3>Ask questions, discover growth</h3>
                <p>Ask in plain language. Every answer arrives with the evidence attached — the trend, the segment, the number — plus the recommended next move.</p>
              </div>
              <div className="step-visual">
                <div className="sv-qa">
                  <div className="qa q">
                    <span className="qa-mark">YOU</span>
                    <p>Which products should I bundle this quarter?</p>
                  </div>
                  <div className="qa a">
                    <span className="qa-mark">MM</span>
                    <p><strong>Desk Mat + Cable Kit</strong> — bought together <strong>2.3×</strong> more often than chance. A checkout bundle is worth an estimated <strong>+$4.8k</strong> this quarter.<span className="caret" aria-hidden="true"></span></p>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ================= FINAL CTA + FOOTER ================= */}
      <section className="final" id="start">
        <div className="container">
          <div className="final-inner" data-reveal>
            <p className="flowline">
              <span>Business data</span>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 8h11m0 0L9 3.5M13.5 8 9 12.5"/></svg>
              <span>AI understanding</span>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 8h11m0 0L9 3.5M13.5 8 9 12.5"/></svg>
              <span>Growth decisions</span>
            </p>
            <h2 className="final-title">Growth is hiding in your spreadsheets.<br /><em>Let's go find it.</em></h2>
            <p className="final-sub">Start with one CSV. Ask your first question. That's the whole setup.</p>
            <button className="btn btn-primary btn-large" onClick={() => router.push("/upload")}>Get Started
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 8h11m0 0L9 3.5M13.5 8 9 12.5"/></svg>
            </button>
            <p className="final-note">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>
              No complex setup required — works with the files you already have.
            </p>
          </div>

          <footer className="footer">
            <div className="footer-inner">
              <a className="brand" href="#top" aria-label="HelperX home">
                <svg className="brand-mark" viewBox="0 0 26 26" aria-hidden="true">
                  <circle cx="13" cy="13" r="11.2" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".5"/>
                  <path d="M13 6.6 7.4 16.2M13 6.6l5.6 9.6M7.4 16.2h11.2" stroke="currentColor" strokeWidth="1.1" fill="none" opacity=".8"/>
                  <circle cx="13" cy="6.6" r="2.1" fill="currentColor"/><circle cx="7.4" cy="16.2" r="2.1" fill="currentColor"/><circle cx="18.6" cy="16.2" r="2.1" fill="currentColor"/>
                </svg>
                <span className="brand-name">HelperX</span>
              </a>
              <p className="footer-right">© {new Date().getFullYear()} HelperX — AI merchant intelligence</p>
            </div>
          </footer>
        </div>
      </section>
    </>
  );
}