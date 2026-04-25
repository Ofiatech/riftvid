'use client';

import { useState, useEffect, useRef } from 'react';
import { useUser, UserButton } from '@clerk/nextjs';
import {
  Home,
  FolderClosed,
  UserSquare2,
  Mic,
  Palette,
  BarChart3,
  Settings,
  HelpCircle,
  Search,
  Bell,
  Plus,
  Sparkles,
  Globe,
  UserPlus,
  Play,
  Upload,
  Zap,
  BarChart2,
  Link2,
  Wand2,
  X,
  Video,
  Library,
  ChevronRight,
  Menu,
  ArrowLeft,
  Loader2,
  Check,
  RefreshCw,
} from 'lucide-react';

/* ============================================================
 * MOCK DATA
 * ============================================================ */

const mockUser = {
  plan: 'Pro',
  credits: 847,
  creditsMax: 1000,
  totalJobs: 12,
};

type VideoStatus = 'Completed' | 'Rendering' | 'Draft' | 'Failed';

interface Video {
  id: string;
  title: string;
  duration: string;
  status: VideoStatus;
  createdAt: string;
  thumbnail: string;
  progress?: number;
}

const mockVideos: Video[] = [
  { id: '1', title: 'Q4 Product Launch Announcement', duration: '2:14', status: 'Completed', createdAt: '2 hours ago', thumbnail: 'purple-indigo' },
  { id: '2', title: 'Onboarding Tutorial — Spanish', duration: '4:32', status: 'Rendering', createdAt: '12 min ago', thumbnail: 'blue-cyan', progress: 67 },
  { id: '3', title: 'CEO Keynote — Digital Twin', duration: '8:45', status: 'Completed', createdAt: 'Yesterday', thumbnail: 'rose-purple' },
  { id: '4', title: 'Weekly Team Update', duration: '1:47', status: 'Draft', createdAt: '3 days ago', thumbnail: 'emerald-teal' },
  { id: '5', title: 'Investor Pitch v3', duration: '5:21', status: 'Rendering', createdAt: '28 min ago', thumbnail: 'amber-rose', progress: 23 },
  { id: '6', title: 'Customer Testimonial Remix', duration: '0:52', status: 'Completed', createdAt: '4 days ago', thumbnail: 'indigo-blue' },
  { id: '7', title: 'Black Friday Campaign Script', duration: '1:05', status: 'Failed', createdAt: '5 days ago', thumbnail: 'slate-zinc' },
  { id: '8', title: 'Product Demo — German Dub', duration: '3:18', status: 'Completed', createdAt: 'Last week', thumbnail: 'violet-fuchsia' },
];

const thumbnailGradients: Record<string, string> = {
  'purple-indigo': 'from-purple-500/40 via-indigo-600/30 to-slate-900',
  'blue-cyan': 'from-blue-500/40 via-cyan-600/30 to-slate-900',
  'rose-purple': 'from-rose-500/40 via-purple-600/30 to-slate-900',
  'emerald-teal': 'from-emerald-500/40 via-teal-600/30 to-slate-900',
  'amber-rose': 'from-amber-500/40 via-rose-600/30 to-slate-900',
  'indigo-blue': 'from-indigo-500/40 via-blue-600/30 to-slate-900',
  'slate-zinc': 'from-slate-600/40 via-zinc-700/30 to-slate-900',
  'violet-fuchsia': 'from-violet-500/40 via-fuchsia-600/30 to-slate-900',
};

/* ============================================================
 * Sidebar
 * ============================================================ */

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeItem, setActiveItem] = useState('Home');
  const { user } = useUser();
  const displayName = user?.fullName || user?.firstName || user?.username || 'Creator';

  const navItems = [
    { name: 'Home', icon: Home },
    { name: 'Projects', icon: FolderClosed },
    { name: 'Avatars', icon: UserSquare2 },
    { name: 'Voices', icon: Mic },
    { name: 'Brand Kit', icon: Palette },
    { name: 'Analytics', icon: BarChart3 },
  ];

  const bottomItems = [
    { name: 'Settings', icon: Settings },
    { name: 'Help', icon: HelpCircle },
  ];

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />
      <aside
        className={`fixed left-0 top-0 h-screen w-64 border-r border-[#141821] bg-[#07070a]/95 backdrop-blur-xl z-40 flex flex-col transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        <div className="px-6 pt-6 pb-8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Play className="w-4 h-4 text-white fill-white" strokeWidth={0} />
            </div>
            <span className="text-[17px] font-semibold tracking-tight">Riftvid</span>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4 text-zinc-400" strokeWidth={2} />
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
            Workspace
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeItem === item.name;
            return (
              <button
                key={item.name}
                onClick={() => setActiveItem(item.name)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[14px] transition-all duration-200 ${
                  isActive ? 'bg-white/[0.06] text-white shadow-sm' : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
                }`}
              >
                <Icon className={`w-[18px] h-[18px] ${isActive ? 'text-purple-400' : ''}`} strokeWidth={1.75} />
                <span className="font-medium">{item.name}</span>
                {isActive && <span className="ml-auto w-1 h-1 rounded-full bg-purple-400" />}
              </button>
            );
          })}
        </nav>

        <div className="px-3 pb-3">
          <div className="rounded-xl border border-[#1f2937] bg-gradient-to-br from-purple-500/[0.06] to-blue-500/[0.04] p-4 relative overflow-hidden">
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-medium text-zinc-300">Credits</span>
                <span className="text-[11px] text-zinc-500">{mockUser.credits}/{mockUser.creditsMax}</span>
              </div>
              <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-400 to-blue-400 rounded-full" style={{ width: `${(mockUser.credits / mockUser.creditsMax) * 100}%` }} />
              </div>
              <button className="mt-3 w-full text-[12px] py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-200 transition-colors">
                Upgrade plan
              </button>
            </div>
          </div>
        </div>

        <div className="px-3 pb-3 space-y-0.5 border-t border-[#141821] pt-3">
          {bottomItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.name} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[14px] text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200 transition-all">
                <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                <span className="font-medium">{item.name}</span>
              </button>
            );
          })}
        </div>

        <div className="px-3 pb-4">
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.03] transition-colors">
            <UserButton appearance={{ elements: { avatarBox: 'w-9 h-9 shadow-md shadow-purple-500/20' } }} />
            <div className="flex-1 text-left min-w-0">
              <div className="text-[13px] font-medium text-white truncate">{displayName}</div>
              <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {mockUser.plan}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

/* ============================================================
 * Topbar
 * ============================================================ */

function Topbar({ onNewGeneration, onToggleSidebar }: { onNewGeneration: () => void; onToggleSidebar: () => void }) {
  return (
    <div className="sticky top-0 z-20 border-b border-[#141821] bg-[#050505]/70 backdrop-blur-xl">
      <div className="flex items-center justify-between px-4 sm:px-10 py-4 gap-3">
        <button
          onClick={onToggleSidebar}
          className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-white/[0.04] transition-colors shrink-0"
          aria-label="Open sidebar"
        >
          <Menu className="w-[20px] h-[20px] text-zinc-300" strokeWidth={2} />
        </button>
        <div className="flex items-center gap-3 flex-1 max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" strokeWidth={2} />
            <input
              type="text"
              placeholder="Search projects, avatars, templates..."
              className="w-full pl-10 pr-4 py-2 bg-white/[0.03] border border-[#1f2937] rounded-lg text-[13px] placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all"
            />
            <kbd className="hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-zinc-500 bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded">
              ⌘K
            </kbd>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="relative p-2 rounded-lg hover:bg-white/[0.04] transition-colors">
            <Bell className="w-[18px] h-[18px] text-zinc-400" strokeWidth={1.75} />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-purple-400" />
          </button>
          <button
            onClick={onNewGeneration}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-b from-white/[0.08] to-white/[0.04] border border-white/[0.08] hover:from-white/[0.12] hover:to-white/[0.06] transition-all text-[13px] font-medium shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.25} />
            <span className="hidden sm:inline">New project</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * HeroCard
 * ============================================================ */

function HeroCard({ onNewGeneration }: { onNewGeneration: () => void }) {
  const { user } = useUser();
  const displayName = user?.firstName || user?.username || 'Creator';

  return (
    <div className="relative rounded-3xl border border-[#1f2937] bg-gradient-to-br from-purple-500/[0.08] via-[#0a0a0b] to-blue-500/[0.05] p-6 sm:p-8 md:p-10 overflow-hidden">
      <div className="absolute -top-32 -right-32 w-80 h-80 rounded-full bg-purple-500/20 blur-[100px] opacity-60" />
      <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full bg-blue-500/15 blur-[100px] opacity-50" />
      <div className="absolute inset-0 opacity-[0.015] mix-blend-overlay pointer-events-none"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}
      />
      <div className="relative z-10 max-w-2xl">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-500/20 text-[10px] font-semibold uppercase tracking-wider text-purple-300 mb-5">
          <Sparkles className="w-3 h-3" strokeWidth={2} />
          Riftvid Studio
        </div>
        <h1 className="text-[28px] sm:text-[36px] md:text-[44px] font-semibold tracking-tight leading-[1.1] text-white mb-3">
          Create Cinematic Magic,{' '}
          <span className="bg-gradient-to-r from-purple-300 to-blue-300 bg-clip-text text-transparent">
            {displayName}.
          </span>
        </h1>
        <p className="text-[14px] sm:text-[15px] text-zinc-400 leading-relaxed mb-6 sm:mb-8 max-w-lg">
          The ultimate AI motion engine at your fingertips. Upload an image, describe the motion, and watch it come alive.
        </p>
        <div className="flex items-center gap-6 sm:gap-8 mb-6 sm:mb-8">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <BarChart2 className="w-4 h-4 text-purple-300" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[18px] font-semibold text-white leading-none">{mockUser.totalJobs}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Total jobs</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Zap className="w-4 h-4 text-amber-300 fill-amber-300/50" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[18px] font-semibold text-white leading-none">{mockUser.credits}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Credits left</div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onNewGeneration}
            className="group relative flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] sm:text-[14px] font-semibold shadow-lg shadow-purple-500/30 transition-all hover:shadow-purple-500/50 hover:-translate-y-0.5"
          >
            <Upload className="w-4 h-4" strokeWidth={2.25} />
            New Generation
          </button>
          <button className="flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-[#1f2937] hover:border-[#2d3748] text-white text-[13px] sm:text-[14px] font-semibold transition-all">
            <Library className="w-4 h-4" strokeWidth={2} />
            My Library
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ToolCard
 * ============================================================ */

interface ToolCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  gradient: string;
  tag: string;
  tagColor: string;
  badge?: string;
  cta: string;
}

function ToolCard({ title, description, icon, gradient, tag, tagColor, badge, cta }: ToolCardProps) {
  return (
    <button className="group relative text-left rounded-2xl border border-[#1f2937] bg-[#0a0a0b] p-4 sm:p-5 overflow-hidden transition-all duration-300 hover:border-[#2d3748] lift grain">
      <div className={`absolute -top-16 -right-16 w-40 h-40 rounded-full ${gradient} blur-3xl opacity-40 group-hover:opacity-70 transition-opacity duration-500`} />
      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div className="w-10 h-10 rounded-xl glass flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
            {icon}
          </div>
          <div className="flex items-center gap-1.5">
            {badge && (
              <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/20">
                {badge}
              </span>
            )}
            <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${tagColor}`}>
              {tag}
            </span>
          </div>
        </div>
        <h3 className="text-[13px] sm:text-[14px] font-semibold text-white mb-1 tracking-tight">{title}</h3>
        <p className="text-[11px] sm:text-[12px] text-zinc-400 leading-relaxed mb-4">{description}</p>
        <div className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 group-hover:text-white transition-colors">
          <span>{cta}</span>
          <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.25} />
        </div>
      </div>
    </button>
  );
}

/* ============================================================
 * VideoCard
 * ============================================================ */

function VideoCard({ video }: { video: Video }) {
  return (
    <div className="group cursor-pointer">
      <div className="relative aspect-video rounded-xl overflow-hidden border border-[#1f2937] bg-[#0a0a0b] lift">
        <div className={`absolute inset-0 bg-gradient-to-br ${thumbnailGradients[video.thumbnail]}`} />
        <div
          className="absolute inset-0 opacity-[0.15] mix-blend-overlay"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
          <div className="w-12 h-12 rounded-full glass-strong flex items-center justify-center shadow-xl scale-90 group-hover:scale-100 transition-transform duration-300">
            <Play className="w-4 h-4 text-white fill-white ml-0.5" strokeWidth={0} />
          </div>
        </div>
        <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-[11px] font-medium text-white border border-white/5">
          {video.duration}
        </div>
        <div className="absolute top-2.5 left-2.5">
          <StatusBadge status={video.status} progress={video.progress} />
        </div>
      </div>
      <div className="mt-3 px-0.5">
        <h4 className="text-[12px] sm:text-[13px] font-medium text-white truncate group-hover:text-purple-200 transition-colors">{video.title}</h4>
        <p className="text-[11px] text-zinc-500 mt-0.5">{video.createdAt}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status, progress }: { status: VideoStatus; progress?: number }) {
  const config = {
    Completed: { className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20', dot: 'bg-emerald-400', pulse: false },
    Rendering: { className: 'bg-purple-500/15 text-purple-200 border-purple-500/25', dot: 'bg-purple-400', pulse: true },
    Draft: { className: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/20', dot: 'bg-zinc-400', pulse: false },
    Failed: { className: 'bg-rose-500/15 text-rose-300 border-rose-500/20', dot: 'bg-rose-400', pulse: false },
  }[status];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold backdrop-blur-md border ${config.className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${config.pulse ? 'pulse-dot' : ''}`} />
      {status}
      {status === 'Rendering' && progress !== undefined && ` ${progress}%`}
    </span>
  );
}

/* ============================================================
 * NewGenerationModal — with Rift Assistant chat (4 questions including voice/accent)
 * ============================================================ */

type ChatMode = 'idle' | 'asking' | 'refining' | 'done';

interface RiftQuestion {
  question: string;
  options: string[];
}

const TOTAL_STEPS = 4;

function NewGenerationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [useUrl, setUseUrl] = useState(false);
  const [aiOptimization, setAiOptimization] = useState(true);
  const [prompt, setPrompt] = useState('');

  const [chatMode, setChatMode] = useState<ChatMode>('idle');
  const [basePrompt, setBasePrompt] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState<RiftQuestion | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [customAnswer, setCustomAnswer] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCustomInput) {
      customInputRef.current?.focus();
    }
  }, [showCustomInput]);

  if (!open) return null;

  const handleClose = () => {
    setChatMode('idle');
    setBasePrompt('');
    setCurrentQuestion(null);
    setAnswers([]);
    setStep(0);
    setCustomAnswer('');
    setShowCustomInput(false);
    setError(null);
    setPrompt('');
    onClose();
  };

  const callRift = async (currentAnswers: string[], currentStep: number) => {
    setError(null);
    try {
      const res = await fetch('/api/rift-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basePrompt,
          answers: currentAnswers,
          step: currentStep,
        }),
      });

      if (!res.ok) throw new Error('Failed to reach Rift Assistant');

      const data = await res.json();

      if (data.done && data.refinedPrompt) {
        setPrompt(data.refinedPrompt);
        setChatMode('done');
      } else if (data.question && data.options) {
        setCurrentQuestion({ question: data.question, options: data.options });
        setChatMode('asking');
      }
    } catch (err) {
      console.error(err);
      setError('Rift had a hiccup. Try again or turn off AI assistance.');
      setChatMode('idle');
    }
  };

  const handleStartRift = async () => {
    if (!prompt.trim()) {
      setError('Please describe your video idea first');
      return;
    }
    setBasePrompt(prompt);
    setAnswers([]);
    setStep(0);
    setChatMode('refining');
    await callRift([], 0);
  };

  const handleAnswer = async (answer: string) => {
    const newAnswers = [...answers, answer];
    const newStep = step + 1;
    setAnswers(newAnswers);
    setStep(newStep);
    setShowCustomInput(false);
    setCustomAnswer('');
    setChatMode('refining');
    await callRift(newAnswers, newStep);
  };

  const handleCustomSubmit = () => {
    if (customAnswer.trim()) {
      handleAnswer(customAnswer.trim());
    }
  };

  const handleRestart = () => {
    setChatMode('idle');
    setAnswers([]);
    setStep(0);
    setCurrentQuestion(null);
    setBasePrompt('');
    setError(null);
  };

  const handleGenerate = () => {
    alert('🎬 Generate video with prompt:\n\n' + prompt);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-[fade-in_0.2s_ease-out]" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#1f2937] bg-[#0a0a0b] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-purple-500/20 blur-[80px] opacity-50 pointer-events-none" />

        <div className="relative p-6 md:p-8">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/20 text-[9px] font-semibold uppercase tracking-wider text-purple-300 mb-2">
                <Sparkles className="w-2.5 h-2.5" strokeWidth={2.5} />
                {chatMode === 'asking' || chatMode === 'refining'
                  ? `Rift is helping · Step ${Math.min(step + 1, TOTAL_STEPS)} of ${TOTAL_STEPS}`
                  : chatMode === 'done'
                  ? 'Refined Prompt Ready'
                  : 'New Generation'}
              </div>
              <h2 className="text-[22px] font-semibold text-white tracking-tight">
                {chatMode === 'done' ? 'Review your prompt' : 'Create a new video'}
              </h2>
              <p className="text-[13px] text-zinc-400 mt-1">
                {chatMode === 'done' ? 'You can edit the prompt below before generating.' : 'Upload an image and describe the motion you want.'}
              </p>
            </div>
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors">
              <X className="w-4 h-4 text-zinc-400" strokeWidth={2} />
            </button>
          </div>

          {/* Upload Media — hidden during chat */}
          {(chatMode === 'idle' || chatMode === 'done') && (
            <div className="mb-5">
              <label className="block text-[12px] font-medium text-zinc-300 mb-2">Upload Media</label>
              {!useUrl ? (
                <label className="block relative border-2 border-dashed border-[#1f2937] hover:border-purple-500/40 rounded-xl p-8 cursor-pointer transition-all bg-white/[0.01] hover:bg-purple-500/[0.02] group">
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" />
                  <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <Upload className="w-5 h-5 text-purple-300" strokeWidth={2} />
                    </div>
                    <div className="text-[14px] font-semibold text-white mb-1">Click to upload media</div>
                    <div className="text-[11px] text-zinc-500">Gallery · Camera · Files — PNG, JPG, WebP</div>
                  </div>
                </label>
              ) : (
                <input
                  type="url"
                  placeholder="https://example.com/image.png"
                  className="w-full px-4 py-3 bg-white/[0.03] border border-[#1f2937] rounded-xl text-[14px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all"
                />
              )}
              <button
                onClick={() => setUseUrl(!useUrl)}
                className="flex items-center gap-1.5 text-[12px] text-zinc-400 hover:text-purple-300 transition-colors mt-3"
              >
                <Link2 className="w-3.5 h-3.5" strokeWidth={2} />
                {useUrl ? 'Upload a file instead' : 'Use image URL instead'}
              </button>
            </div>
          )}

          {/* Prompt textarea OR Chat UI */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[12px] font-medium text-zinc-300">
                {chatMode === 'asking' || chatMode === 'refining' ? 'Rift Assistant' : 'Motion Prompt'}
              </label>
              {chatMode === 'asking' && (
                <button
                  onClick={handleRestart}
                  className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-purple-300 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" strokeWidth={2} />
                  Start over
                </button>
              )}
            </div>

            {(chatMode === 'idle' || chatMode === 'done') && (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={chatMode === 'done' ? 6 : 3}
                placeholder={aiOptimization ? "Describe your video idea... Rift will refine it for you" : "Write your full cinematic prompt here..."}
                className="w-full px-4 py-3 bg-white/[0.03] border border-[#1f2937] rounded-xl text-[14px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all resize-none"
              />
            )}

            {chatMode === 'refining' && (
              <div className="rounded-xl border border-[#1f2937] bg-white/[0.02] p-8 flex flex-col items-center text-center">
                <Loader2 className="w-8 h-8 text-purple-400 animate-spin mb-3" strokeWidth={2} />
                <div className="text-[14px] font-medium text-white mb-1">
                  {step === 0 ? 'Rift is thinking...' : step === TOTAL_STEPS ? '✨ Crafting your cinematic prompt...' : 'Getting next question...'}
                </div>
                <div className="text-[12px] text-zinc-500">This takes just a moment</div>
              </div>
            )}

            {chatMode === 'asking' && currentQuestion && (
              <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.06] to-blue-500/[0.03] p-5">
                {/* Step indicator — 4 dots now */}
                <div className="flex items-center gap-2 mb-4">
                  {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-all ${
                        i < step ? 'bg-purple-400' : i === step ? 'bg-purple-400/60' : 'bg-white/[0.06]'
                      }`}
                    />
                  ))}
                </div>

                <div className="flex items-start gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shrink-0 shadow-lg shadow-purple-500/30">
                    <Sparkles className="w-4 h-4 text-white" strokeWidth={2} />
                  </div>
                  <div className="flex-1 pt-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-300 mb-1">Rift Assistant</div>
                    <div className="text-[15px] font-medium text-white leading-snug">{currentQuestion.question}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  {currentQuestion.options.map((option, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleAnswer(option)}
                      className="text-left px-3 py-2.5 rounded-lg bg-white/[0.04] hover:bg-purple-500/15 border border-white/[0.06] hover:border-purple-500/40 text-[13px] font-medium text-zinc-200 hover:text-white transition-all hover:-translate-y-0.5"
                    >
                      {option}
                    </button>
                  ))}
                </div>

                {!showCustomInput ? (
                  <button
                    onClick={() => setShowCustomInput(true)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] border border-dashed border-white/[0.08] hover:border-purple-500/30 text-[12px] font-medium text-zinc-400 hover:text-white transition-all"
                  >
                    <span>✏️</span>
                    Or type your own
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <input
                      ref={customInputRef}
                      type="text"
                      value={customAnswer}
                      onChange={(e) => setCustomAnswer(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCustomSubmit()}
                      placeholder="Type your answer..."
                      className="flex-1 px-3 py-2 bg-white/[0.04] border border-purple-500/30 rounded-lg text-[13px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/60 transition-all"
                    />
                    <button
                      onClick={handleCustomSubmit}
                      disabled={!customAnswer.trim()}
                      className="px-3 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      <Check className="w-4 h-4" strokeWidth={2.5} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-[12px] text-rose-300">
                {error}
              </div>
            )}
          </div>

          {/* Rift toggle — only when idle */}
          {chatMode === 'idle' && (
            <div className={`relative rounded-xl border p-4 mb-5 transition-all ${
              aiOptimization
                ? 'border-purple-500/30 bg-gradient-to-br from-purple-500/[0.08] to-blue-500/[0.03]'
                : 'border-[#1f2937] bg-white/[0.02]'
            }`}>
              {aiOptimization && (
                <div className="absolute -inset-px rounded-xl bg-gradient-to-r from-purple-500/20 via-purple-400/10 to-blue-500/20 blur-sm opacity-60 pointer-events-none" />
              )}
              <div className="relative flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                  aiOptimization
                    ? 'bg-purple-500/20 border border-purple-500/30 shadow-lg shadow-purple-500/20'
                    : 'bg-white/[0.04] border border-white/[0.06]'
                }`}>
                  <Wand2 className={`w-4 h-4 ${aiOptimization ? 'text-purple-300' : 'text-zinc-500'}`} strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[13px] font-semibold text-white">Rift Assistant</span>
                    {aiOptimization && (
                      <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-200 border border-purple-500/30">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    {aiOptimization ? 'AI will refine your prompt with quick questions' : 'Skip AI — use your own prompt directly'}
                  </p>
                </div>
                <button
                  onClick={() => setAiOptimization(!aiOptimization)}
                  className={`relative w-11 h-6 rounded-full transition-all shrink-0 ${
                    aiOptimization ? 'bg-gradient-to-r from-purple-500 to-purple-400 shadow-lg shadow-purple-500/30' : 'bg-white/[0.08]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${
                      aiOptimization ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t border-[#141821] gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400/50" strokeWidth={2} />
              <span><span className="text-zinc-300 font-medium">1 credit</span> · {mockUser.credits} available</span>
            </div>

            <div className="flex items-center gap-2">
              {chatMode === 'idle' && (
                <>
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={aiOptimization ? handleStartRift : handleGenerate}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
                  >
                    <Wand2 className="w-3.5 h-3.5" strokeWidth={2.25} />
                    {aiOptimization ? 'Generate with Rift' : 'Generate Video'}
                  </button>
                </>
              )}

              {(chatMode === 'asking' || chatMode === 'refining') && (
                <button
                  onClick={handleRestart}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors"
                >
                  Cancel
                </button>
              )}

              {chatMode === 'done' && (
                <>
                  <button
                    onClick={handleRestart}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.03] transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
                    Back
                  </button>
                  <button
                    onClick={handleGenerate}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white text-[13px] font-semibold shadow-lg shadow-purple-500/30 transition-all"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" strokeWidth={0} />
                    Generate Video
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * Dashboard
 * ============================================================ */

export default function Dashboard() {
  const [modalOpen, setModalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setSidebarOpen(e.matches);
    };
    handleChange(mediaQuery);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen && window.innerWidth < 1024) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [sidebarOpen]);

  return (
    <div className="min-h-screen bg-[#050505] text-white relative">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="lg:ml-64 relative z-[1]">
        <Topbar
          onNewGeneration={() => setModalOpen(true)}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />

        <div className="px-4 sm:px-10 py-6 sm:py-8 max-w-[1400px] fade-up">
          <section className="mb-8">
            <HeroCard onNewGeneration={() => setModalOpen(true)} />
          </section>

          <section className="mb-10 sm:mb-12">
            <h2 className="text-[13px] font-medium text-zinc-500 uppercase tracking-wider mb-4">
              Studio Tools
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <ToolCard title="Image to Motion" description="Transform any still into cinematic video" icon={<Video className="w-5 h-5 text-purple-300" strokeWidth={1.75} />} gradient="bg-purple-500" tag="Core" tagColor="bg-purple-500/15 text-purple-300 border border-purple-500/20" cta="Generate" />
              <ToolCard title="Generate from Prompt" description="Describe your video in plain English. AI handles it all" icon={<Sparkles className="w-5 h-5 text-blue-300" strokeWidth={1.75} />} gradient="bg-blue-500" tag="AI" tagColor="bg-blue-500/15 text-blue-300 border border-blue-500/20" badge="New" cta="Create" />
              <ToolCard title="Translate Video" description="Dub any video into 40+ languages with lip-sync" icon={<Globe className="w-5 h-5 text-emerald-300" strokeWidth={1.75} />} gradient="bg-emerald-500" tag="Presets" tagColor="bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" cta="Translate" />
              <ToolCard title="Digital Twin" description="Create a photoreal AI avatar from 2 min of footage" icon={<UserPlus className="w-5 h-5 text-rose-300" strokeWidth={1.75} />} gradient="bg-rose-500" tag="Vault" tagColor="bg-amber-500/15 text-amber-300 border border-amber-500/20" cta="Create twin" />
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-5 gap-2">
              <h2 className="text-[13px] font-medium text-zinc-500 uppercase tracking-wider">Recent Projects</h2>
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-[#1f2937]">
                  <button className="px-2.5 py-1 text-[12px] rounded-md bg-white/[0.06] text-white font-medium">All</button>
                  <button className="px-2.5 py-1 text-[12px] rounded-md text-zinc-400 hover:text-white transition-colors">Completed</button>
                  <button className="px-2.5 py-1 text-[12px] rounded-md text-zinc-400 hover:text-white transition-colors">Drafts</button>
                </div>
                <button className="text-[12px] text-zinc-400 hover:text-white transition-colors font-medium whitespace-nowrap">View all →</button>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5">
              {mockVideos.slice(0, 4).map((video) => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          </section>

          <div className="h-16" />
        </div>
      </main>

      <NewGenerationModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
