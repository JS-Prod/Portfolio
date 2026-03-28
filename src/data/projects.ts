export type ProjectDemoLink = {
  label: string
  href: string
}

export type Project = {
  id: string
  title: string
  year: string
  role: string
  summary: string
  demoLabel: string
  demoNote: string
  demoUrl?: string
  demoLinks?: ProjectDemoLink[]
  contribution: string
  approach: string
  impact: string
  theme: string
  stack: string[]
  coordinates: [number, number, number]
  color: string
}

export const projects: Project[] = [
  {
    id: 'gpgpu-particles',
    title: 'GPGPU Particles',
    year: '2025',
    role: 'Solo Creative Developer',
    summary:
      'A real-time GPU particle system that simulates 1,000,000 particles in the browser. Particles form the shell of 3D models, then surge toward the camera in wave-like bursts to create a cinematic fly-through effect.',
    demoLabel: 'Live In Scene',
    demoNote:
      'This node is a live demo. Orbit and zoom to inspect the full simulation loop, model transitions, and particle burst behavior in real time.',
    contribution:
      'Built the entire project end to end as the sole developer, including the simulation pipeline, shader logic, model sequencing, visual direction, and performance tuning.',
    approach:
      'Used a GPU-first architecture with ping-pong simulation textures and custom GLSL passes, then separated simulation and render stages so high particle counts remain stable and art-directable.',
    impact:
      'Delivers an infinite model-to-particle-to-dissolve loop at one million particles in real time, demonstrating shader engineering and performance-conscious 3D systems design.',
    theme: 'Generative simulation',
    stack: ['React', 'React Three Fiber', 'Three.js', 'GPGPU', 'GLSL', 'TypeScript'],
    coordinates: [-2.6, 1.1, -1.8],
    color: '#7ec8ff',
  },
  {
    id: 'voyce',
    title: 'Voyce',
    year: '2025',
    role: 'Solo Full-Stack Engineer',
    summary:
      'A production voice-agent platform for business phone operations, currently tailored to Allied Medical and designed to be quickly repurposed for other industries.',
    demoLabel: 'Open Voyce',
    demoNote:
      'Production workflow demo showing real-time call handling, transcript flow, and backend orchestration for voice-first customer interactions.',
    demoUrl: 'https://wirmi.net/voyce',
    demoLinks: [{ label: 'Live Product', href: 'https://wirmi.net/voyce' }],
    contribution:
      'Developed the full platform as the sole engineer: client portal, real-time audio backend, telephony integrations, conversation engine, billing, and knowledge-base infrastructure.',
    approach:
      'Split stateless orchestration into Next.js APIs and low-latency call/audio work into a dedicated Node.js WebSocket service. Kept thin adapter layers around LLM, TTS, and telephony providers to swap implementations without rewriting the core pipeline.',
    impact:
      'Supports Twilio PSTN and PBX/SIP integration paths, barge-in turn taking with VAD, Stripe billing, and dual-database RAG architecture (Supabase as source of truth, Qdrant for semantic retrieval).',
    theme: 'Voice infrastructure',
    stack: [
      'Next.js',
      'Node.js',
      'WebSockets',
      'Twilio',
      'Vertex AI (Gemini + Chirp)',
      'Supabase',
      'Qdrant',
      'Stripe',
    ],
    coordinates: [0.45, -0.7, 1.6],
    color: '#93f6d8',
  },
  {
    id: 'tone-tap',
    title: 'Tone Tap',
    year: '2024',
    role: 'Solo Mobile + Backend Engineer',
    summary:
      'A published Android music-memory game where players replay increasingly long note sequences generated from random keys and scales, creating patterns that sound musical rather than arbitrary.',
    demoLabel: 'Playable Build',
    demoNote:
      'Shipped game with account management, moderation workflows, monetization systems, and a live backend supporting progression and leaderboard features.',
    demoLinks: [
      { label: 'Google Play Search', href: 'https://play.google.com/store/search?q=Tone%20Tap&c=apps' },
    ],
    contribution:
      'Built everything as the sole developer across gameplay, backend services, authentication, monetization, moderation tooling, and custom sound design.',
    approach:
      'Implemented the 12-note chromatic input model with scale-constrained sequence generation for musically coherent rounds, while keeping gameplay low-latency on device and server-critical systems authoritative on the backend.',
    impact:
      'Delivered custom token auth with Google sign-in and email verification/reset flows, leaderboard reporting with rewarded moderation, AdMob ads, coin/soundpack shop, and configurable speed, palette, and font settings.',
    theme: 'Interactive audio gameplay',
    stack: ['Android', 'Node.js', 'Express', 'MongoDB', 'Google Sign-In', 'Nodemailer', 'Google AdMob'],
    coordinates: [2.7, 0.9, -0.5],
    color: '#ffc792',
  },
]
