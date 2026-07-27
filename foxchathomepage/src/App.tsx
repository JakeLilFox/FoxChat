import { useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import './App.css'

function TiltCard(props: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const [hovering, setHovering] = useState(false)

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    setTilt({ x: -y * 8, y: x * 8 })
  }

  const handleMouseEnter = () => setHovering(true)
  const handleMouseLeave = () => {
    setHovering(false)
    setTilt({ x: 0, y: 0 })
  }

  const style: React.CSSProperties = {
    transform: `perspective(600px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
    transition: hovering ? 'none' : 'transform 0.3s ease-out',
  }

  return (
    <div
      ref={ref}
      className={props.className}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={style}
    >
      {props.children}
    </div>
  )
}

const features = [
  {
    color: '#e06a28',
    title: 'Quiet notifications',
    desc: "You get one notification with sound per room. Everything else stays silent until you've read them.",
  },
  {
    color: '#5b8def',
    title: 'Full protocol support',
    desc: "Spaces, threads, reactions. Everything renders the way it's supposed to look.",
  },
  {
    color: '#4da860',
    title: 'Web, Desktop & Mobile',
    desc: 'Use it in your browser, on your desktop, or on your Android phone.',
  },
  {
    color: '#8b5cf0',
    title: 'End-to-end encryption',
    desc: 'Full E2E encryption with cross-signing, key backup, and device verification.',
  },
  {
    color: '#e04572',
    title: 'Customizable',
    desc: 'Dark and light themes, custom backgrounds, adjustable font sizes, and emoji packs.',
  },
  {
    color: '#3aa6e0',
    title: 'Multi-account',
    desc: 'Log in with multiple Matrix accounts and see all rooms in one combined view.',
  },
  {
    color: '#e8a52a',
    title: 'Android Auto notifications',
    desc: 'Get your chat notifications right on the dashboard while driving.',
  },
]

function App() {
  const [repoCopied, setRepoCopied] = useState(false)
  const copyFdroidRepo = async () => {
    await navigator.clipboard.writeText('https://fdroid.jakefox.de/repo')
    setRepoCopied(true)
    window.setTimeout(() => setRepoCopied(false), 1800)
  }

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-content">
          <img src="/favicon.png" alt="FoxChat" className="logo-img" />
          <h1>FoxChat</h1>
          <p className="tagline">
            A comfortable Matrix client for your desktop, browser, and phone.
          </p>
          <div className="hero-cta">
            <a href="https://chat.jakefox.de" className="btn primary">
              Open FoxChat
            </a>
            <a href="#platforms" className="btn secondary">
              Download
            </a>
          </div>
        </div>
      </header>

      <section className="screenshot">
        <div className="screenshot-frame">
          <img src="/img.png" alt="FoxChat screenshot" className="screenshot-img" />
        </div>
      </section>

      <section className="features">
        <h2>What makes FoxChat different</h2>
        <div className="feature-grid">
          {features.map((feature) => (
            <TiltCard key={feature.title} className="feature-card">
              <div
                className="feature-accent"
                style={{ '--accent-color': feature.color } as React.CSSProperties}
              />
              <h3>{feature.title}</h3>
              <p>{feature.desc}</p>
            </TiltCard>
          ))}
        </div>
      </section>

      <section className="platforms" id="platforms">
        <h2>Available everywhere</h2>
        <div className="platform-grid">
          <a href="https://chat.jakefox.de" className="platform-card">
            <div className="platform-accent" />
            <h3>Web</h3>
            <p>Open in your browser</p>
            <span className="platform-link">chat.jakefox.de</span>
          </a>
          <a href="public/FoxChat_0.1.0_x64-setup.exe" className="platform-card">
            <div className="platform-accent" />
            <h3>Desktop</h3>
            <p>Windows &amp; macOS</p>
            <span className="platform-link">Download setup</span>
          </a>
          <a
            href="https://play.google.com/store/apps/details?id=foxchat.jakefox.de"
            className="platform-card"
          >
            <div className="platform-accent" />
            <h3>Android</h3>
            <p>On the Google Play Store</p>
            <span className="platform-link">Play Store</span>
          </a>
        </div>

        <div className="fdroid-section">
          <div className="fdroid-copy">
            <span className="fdroid-eyebrow">Recommended for Android</span>
            <h3>Get faster updates with F-Droid</h3>
            <p>
              Google Play review can delay new FoxChat releases. Add the official FoxChat repository
              to F-Droid to receive the newest version as soon as it is published.
            </p>
            <button type="button" className="btn primary" onClick={() => void copyFdroidRepo()}>
              {repoCopied ? 'Repository copied' : 'Copy repository address'}
            </button>
          </div>
          <div className="fdroid-steps">
            <h4>Add the repository first</h4>
            <ol>
              <li>
                <a href="https://f-droid.org/en/" target="_blank" rel="noopener noreferrer">
                  Download F-Droid
                </a>{' '}
                and open the app.
              </li>
              <li>
                Open <strong>Settings</strong>, then <strong>Repositories</strong>.
              </li>
              <li>
                Add this repository address:
                <code className="repo-address">fdroid.jakefox.de/repo</code>
              </li>
              <li>Refresh F-Droid, search for FoxChat, and install it.</li>
            </ol>
          </div>
        </div>

        <div className="linux-section">
          <h3>Linux</h3>
          <div className="linux-grid">
            <a href="public/FoxChat_0.1.0_amd64.deb" className="linux-card">
              <span className="linux-format">.deb</span>
              <span>Debian / Ubuntu</span>
            </a>
            <a href="public/FoxChat-0.1.0-1.x86_64.rpm" className="linux-card">
              <span className="linux-format">.rpm</span>
              <span>Fedora / RHEL</span>
            </a>
            <a href="public/FoxChat_0.1.0_amd64.AppImage" className="linux-card">
              <span className="linux-format">.AppImage</span>
              <span>Universal</span>
            </a>
          </div>
        </div>

        <div className="bridge-section">
          <div className="bridge-copy">
            <span className="bridge-eyebrow">Optional browser companion</span>
            <h3>FoxChat Bridge</h3>
            <p>
              Connect the FoxChat web app to trusted automation tools running on your computer.
              After downloading, run the executable with <code>--install</code> to start it
              automatically when you sign in.
            </p>
            <a className="bridge-doc-link" href="/apispecs/">
              Automation API reference
            </a>
          </div>
          <div className="bridge-grid">
            <a href="public/FoxChatBridge-windows-x86_64.exe" className="bridge-card" download>
              <span className="bridge-platform">Windows</span>
              <span>Download .exe</span>
            </a>
            <a href="public/FoxChatBridge-linux-x86_64" className="bridge-card" download>
              <span className="bridge-platform">Linux</span>
              <span>Download executable</span>
            </a>
          </div>
        </div>
      </section>

      <footer>
        <p>
          FoxChat is built on{' '}
          <a href="https://matrix.org" target="_blank" rel="noopener">
            Matrix
          </a>
          .{' '}
          <a
            href="https://github.com/JakeLilFox/FoxChat"
            target="_blank"
            rel="noopener noreferrer"
          >
            View FoxChat on GitHub
          </a>
          .
        </p>
      </footer>
    </div>
  )
}

export default App
