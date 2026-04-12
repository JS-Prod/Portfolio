export type ProjectDemoLink = {
  label: string;
  href: string;
};

export type Project = {
  id: string;
  title: string;
  year: string;
  role: string;
  summary: string;
  demoLabel: string;
  demoNote: string;
  demoUrl?: string;
  demoLinks?: ProjectDemoLink[];
  contribution: string;
  approach: string;
  impact: string;
  theme: string;
  stack: string[];
  coordinates: [number, number, number];
  color: string;
};

export const projects: Project[] = [
  {
    id: "gpgpu-particles",
    title: "Dreamfield Particles",
    year: "2025",
    role: "Sole Developer (Creative Tech)",
    summary:
      "A browser-based GPGPU particle simulation running 1,000,000 particles in real time. Each cycle maps particles to the shell of a 3D model, then drives them toward the camera in a sine-wave burst before transitioning to the next model. \n \n  The cursor position displaces particles around it allowing the user to create liquidy streaks through the particle system.",
    demoLabel: "Live In Scene",
    demoNote: "Project currently live on the website.",
    demoLinks: [
      { label: "Dreamfield Demo", href: "https://wirmi.net/dreamfield" },
    ],
    contribution:
      "I built this end to end myself, including the simulation pipeline, shader authoring, model sequencing, visual direction, and performance profiling.",
    approach:
      "I kept particle updates entirely on the GPU using ping-pong simulation textures and custom GLSL passes. I also designed the motion as a single shader-driven loop (shape lock, forward burst, reset), which made the sequence easier to tune while keeping one million particles stable.",
    impact:
      "The simulation now runs smoothly at 1,000,000 particles in real time in the browser. The cursor displacement effect creates fluid, streak-like motion through the field, adding interaction that feels intentional and not just decorative.",
    theme: "Generative simulation",
    stack: [
      "React",
      "React Three Fiber",
      "Three.js",
      "GPGPU",
      "GLSL",
      "TypeScript",
    ],
    coordinates: [-2.6, 1.1, -1.8],
    color: "#7ec8ff",
  },
  {
    id: "voyce",
    title: "Voyce",
    year: "2025",
    role: "Sole Developer (Full Stack + Voice AI)",
    summary:
      "A production voice-agent platform for business phone operations. It is currently tuned for Allied Medical, but the platform is designed so it can be adapted quickly for other industries.",
    demoLabel: "Open Voyce",
    demoNote:
      "Live product with the real client workflow: customer onboarding, agent customization, and real-time call orchestration.",
    demoUrl: "https://wirmi.net/voyce",
    demoLinks: [{ label: "Live Product", href: "https://wirmi.net/voyce" }],
    contribution:
      "I built the entire platform myself: the Next.js client portal, real-time audio/call backend, telephony integrations, conversation engine, billing flow, and knowledge-base infrastructure.",
    approach:
      "I separated stateless workflows into Next.js APIs and low-latency media handling into a dedicated Node.js WebSocket service. I also kept thin provider adapters around LLM, TTS, and telephony layers so services can be swapped without changing the core conversation pipeline.",
    impact:
      "Voyce supports Twilio PSTN and PBX/SIP integration, AI-to-human handoff via SIP phones, barge-in turn taking with VAD, Stripe billing, usage/cost tracking, and a dual-database RAG architecture (Supabase + Qdrant).",
    theme: "Voice infrastructure",
    stack: [
      "Next.js",
      "Node.js",
      "WebSockets",
      "Twilio",
      "Vertex AI (Gemini + Chirp)",
      "Supabase",
      "Qdrant",
      "Stripe",
    ],
    coordinates: [0.45, -0.7, 1.6],
    color: "#93f6d8",
  },
  {
    id: "tone-tap",
    title: "Tone Tap",
    year: "2024",
    role: "Sole Developer (Mobile + Backend)",
    summary:
      "A published Android music-memory game where each round adds one note to a sequence the player has to replay. Notes are generated from a random key and scale, so patterns feel musical rather than random.",
    demoLabel: "Playable Build",
    demoNote:
      "Published game with account, backend, moderation, and monetization systems rather than a gameplay-only prototype.",
    demoLinks: [
      {
        label: "Google Play Search",
        href: "https://play.google.com/store/search?q=com.wirmi.mybeat",
      },
    ],
    contribution:
      "I built the entire app and backend myself, including gameplay systems, auth, progression, moderation tooling, monetization, and custom sound design created in Ableton Live.",
    approach:
      "I implemented a 12-note chromatic input model with scale-constrained sequence generation to keep the game musically coherent. Gameplay timing is handled client-side for responsiveness, while account, leaderboard, and store logic is enforced server-side.",
    impact:
      "Shipped with custom token auth, Google login, email verification and reset flows, leaderboard reporting with rewarded moderation, AdMob, a coin/soundpack shop, and user settings for speed, color palette, and font.",
    theme: "Interactive audio gameplay",
    stack: [
      "Android",
      "Node.js",
      "Express",
      "MongoDB",
      "Google Sign-In",
      "Nodemailer",
      "Google AdMob",
    ],
    coordinates: [2.7, 0.9, -0.5],
    color: "#ffc792",
  },
];
