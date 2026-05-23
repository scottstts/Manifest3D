import { desktopOnlyMessage, isMobileBrowser } from './app/desktopGate'
import { installConsoleWarningFilter } from './app/consoleWarningFilter'

installConsoleWarningFilter(console)

if (isMobileBrowser(window.navigator, (query) => window.matchMedia(query).matches)) {
  renderDesktopOnlyMessage()
} else {
  loadDesktopDocumentAssets()
  void import('./bootstrapApp').then(({ renderApp }) => renderApp())
}

function renderDesktopOnlyMessage() {
  const root = document.getElementById('root')

  if (!root) {
    return
  }

  document.documentElement.style.cssText = 'width:100%;height:100%;'
  document.body.style.cssText = [
    'width:100%',
    'min-width:0',
    'height:100%',
    'margin:0',
    'overflow:hidden',
    'background:#ecebfb',
    'color:#17205c',
    'font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    '-webkit-font-smoothing:antialiased',
  ].join(';')
  root.style.cssText = [
    'position:relative',
    'width:100%',
    'height:100%',
  ].join(';')

  const frame = document.createElement('div')
  const nav = document.createElement('header')
  const brand = document.createElement('div')
  const logo = document.createElement('img')
  const wordmark = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const message = document.createElement('p')

  frame.style.cssText = [
    'position:relative',
    'width:100%',
    'height:100%',
    'overflow:hidden',
    'background:linear-gradient(140deg,#f3f2ff 0%,#ddddea 52%,#f7f5ff 100%)',
  ].join(';')
  nav.setAttribute('aria-label', 'Manifest3D')
  nav.style.cssText = [
    'position:absolute',
    'top:8px',
    'left:8px',
    'right:8px',
    'z-index:1',
    'display:flex',
    'align-items:center',
    'height:64px',
    'padding:0 12px 0 6px',
    'background:linear-gradient(180deg,rgb(255 255 255 / 0.86),rgb(244 242 255 / 0.78)),rgb(249 248 255 / 0.82)',
    'border:1px solid rgb(137 132 226 / 0.26)',
    'border-radius:15px',
    'box-shadow:0 16px 44px rgb(76 69 176 / 0.15),inset 0 1px 0 rgb(255 255 255 / 0.96)',
    'backdrop-filter:blur(26px)',
  ].join(';')
  brand.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:8px',
    'min-width:0',
    'transform:translateZ(0)',
  ].join(';')
  logo.alt = 'Manifest3D'
  logo.src = '/logo.png'
  logo.style.cssText = [
    'display:block',
    'width:42px',
    'height:42px',
    'object-fit:contain',
    'filter:drop-shadow(0 6px 8px rgb(118 78 222 / 0.24))',
    'transform:translateX(8px)',
  ].join(';')
  wordmark.setAttribute('aria-hidden', 'true')
  wordmark.setAttribute('viewBox', '0 0 390 90')
  wordmark.style.cssText = [
    'display:block',
    'width:min(48vw,260px)',
    'height:46px',
    'overflow:visible',
  ].join(';')
  wordmark.innerHTML = desktopWordmarkSvgContent()
  message.textContent = desktopOnlyMessage
  message.style.cssText = [
    'position:absolute',
    'left:24px',
    'right:24px',
    'top:50%',
    'max-width:36rem',
    'margin:0',
    'margin-inline:auto',
    'color:#293174',
    'font-size:clamp(1.35rem,6vw,2rem)',
    'font-weight:900',
    'line-height:1.28',
    'text-align:center',
    'transform:translateY(-50%)',
  ].join(';')
  brand.append(logo, wordmark)
  nav.append(brand)
  frame.append(nav, message)
  root.replaceChildren(frame)
}

function desktopWordmarkSvgContent() {
  return `
    <defs>
      <linearGradient id="manifestWordmarkGrad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#f0d7ff" />
        <stop offset="38%" stop-color="#c67aff" />
        <stop offset="100%" stop-color="#8424e8" />
      </linearGradient>
      <filter
        height="142%"
        id="manifestWordmarkGlass"
        width="142%"
        x="-21%"
        y="-21%"
      >
        <feGaussianBlur
          in="SourceAlpha"
          result="smoothAlpha"
          stdDeviation="3.5"
        />
        <feSpecularLighting
          in="smoothAlpha"
          lighting-color="#ffffff"
          result="specLight"
          specularConstant="1.15"
          specularExponent="45"
          surfaceScale="4"
        >
          <feDistantLight azimuth="-45" elevation="55" />
        </feSpecularLighting>
        <feComposite
          in="specLight"
          in2="SourceAlpha"
          operator="in"
          result="specLightMasked"
        />
        <feGaussianBlur
          in="SourceAlpha"
          result="shadowBlur"
          stdDeviation="2"
        />
        <feOffset dx="-1" dy="4" in="shadowBlur" result="shadowOffset" />
        <feComposite
          in="SourceAlpha"
          in2="shadowOffset"
          operator="out"
          result="shadowMask"
        />
        <feFlood
          flood-color="#410082"
          flood-opacity="0.74"
          result="shadowColor"
        />
        <feComposite
          in="shadowColor"
          in2="shadowMask"
          operator="in"
          result="innerShadow"
        />
        <feOffset dx="1" dy="-2" in="shadowBlur" result="rimOffset" />
        <feComposite
          in="SourceAlpha"
          in2="rimOffset"
          operator="out"
          result="rimMask"
        />
        <feFlood
          flood-color="#ffffff"
          flood-opacity="0.62"
          result="rimColor"
        />
        <feComposite
          in="rimColor"
          in2="rimMask"
          operator="in"
          result="innerRim"
        />
        <feMerge result="merged">
          <feMergeNode in="SourceGraphic" />
          <feMergeNode in="innerShadow" />
          <feMergeNode in="innerRim" />
          <feMergeNode in="specLightMasked" />
        </feMerge>
        <feDropShadow
          dx="0"
          dy="8"
          flood-color="#6924c6"
          flood-opacity="0.24"
          in="merged"
          stdDeviation="6"
        />
      </filter>
    </defs>
    <text
      dominant-baseline="middle"
      fill="url(#manifestWordmarkGrad)"
      filter="url(#manifestWordmarkGlass)"
      font-family="Arial Rounded MT Bold, Avenir Next, Inter, ui-sans-serif, system-ui, sans-serif"
      font-size="62"
      font-weight="800"
      letter-spacing="0"
      stroke="#6416b5"
      stroke-opacity="0.78"
      stroke-width="2"
      x="0"
      y="55%"
    >
      Manifest3D
    </text>
  `
}

function loadDesktopDocumentAssets() {
  appendLink({
    href: '/logo.png',
    rel: 'icon',
    type: 'image/png',
  })
  appendLink({
    crossorigin: 'anonymous',
    href: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css',
    integrity:
      'sha512-Evv84Mr4kqVGRNSgIGL/F/aIDqQb7xQ2vcrdIwxfjThSH8CSR7PBEakCr51Ck+w+/U6swU2Im1vVX0SVk9ABhg==',
    referrerpolicy: 'no-referrer',
    rel: 'stylesheet',
  })
}

function appendLink(attributes: Record<string, string>) {
  const link = document.createElement('link')

  for (const [name, value] of Object.entries(attributes)) {
    link.setAttribute(name, value)
  }

  document.head.append(link)
}
