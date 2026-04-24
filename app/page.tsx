'use client';

import { useState } from 'react';
import {
  Home,
  FolderClosed,
  UserSquare2,
  Mic,
  Palette,
  BarChart3,
  Settings,
  HelpCircle,
  ChevronsUpDown,
  Search,
  Bell,
  Plus,
  ArrowRight,
  Sparkles,
  Globe,
  UserPlus,
  Play,
} from 'lucide-react';

/* ============================================================
 * MOCK DATA — move to /lib/mock-data.ts later
 * ============================================================ */

const mockUser = {
  name: 'Alex Morgan',
  email: 'alex@riftvid.ai',
  plan: 'Pro',
  avatar: 'AM',
  credits: 847,
  creditsMax: 1000,
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
  {
    id: '1',
    title: 'Q4 Product Launch Announcement',
    duration: '2:14',
    status: 'Completed',
    createdAt: '2 hours ago',
    thumbnail: 'purple-indigo',
  },
  {
    id: '2',
    title: 'Onboarding Tutorial — Spanish',
    duration: '4:32',
    status: 'Rendering',
    createdAt: '12 min ago',
    thumbnail: 'blue-cyan',
    progress: 67,
  },
  {
    id: '3',
    title: 'CEO Keynote — Digital Twin',
    duration: '8:45',
    status: 'Completed',
    createdAt: 'Yesterday',
    thumbnail: 'rose-purple',
  },
  {
    id: '4',
    title: 'Weekly Team Update',
    duration: '1:47',
    status: 'Draft',
    createdAt: '3 days ago',
    thumbnail: 'emerald-teal',
  },
  {
    id: '5',
    title: 'Investor Pitch v3',
    duration: '5:21',
    status: 'Rendering',
    createdAt: '28 min ago',
    thumbnail: 'amber-rose',
    progress: 23,
  },
  {
    id: '6',
    title: 'Customer Testimonial Remix',
    duration: '0:52',
    status: 'Completed',
    createdAt: '4 days ago',
    thumbnail: 'indigo-blue',
  },
  {
    id: '7',
    title: 'Black Friday Campaign Script',
    duration: '1:05',
    status: 'Failed',
    createdAt: '5 days ago',
    thumbnail: 'slate-zinc',
  },
  {
    id: '8',
    title: 'Product Demo — German Dub',
    duration: '3:18',
    status: 'Completed',
    createdAt: 'Last week',
    thumbnail: 'violet-fuchsia',
  },
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
 * Sidebar.tsx
 * ============================================================ */

function Sidebar() {
  const [activeItem, setActiveItem] = useState('Home');

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
    <aside className="fixed left-0 top-0 h-screen w-64 border-r border-[#141821] bg-[#07070a]/80 backdrop-blur-xl z-20 flex flex-col">
      {/* Logo */}
      <div className="px-6 pt-6 pb-8">
        <div className="flex items-center gap-2.5">
          <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Play className="w-4 h-4 text-white fill-white" strokeWidth={0} />
          </div>
          <span className="text-[17px] font-semibold tracking-tight">Riftvid</span>
        </div>
      </div>

      {/* Primary Nav */}
      <nav className="flex-1 px-3 space-y-0.5">
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
                isActive
                  ? 'bg-white/[0.06] text-white shadow-sm'
                  : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
              }`}
            >
              <Icon
                className={`w-[18px] h-[18px] ${isActive ? 'text-purple-400' : ''}`}
                strokeWidth={1.75}
              />
              <span className="font-medium">{item.name}</span>
              {isActive && (
                <span className="ml-auto w-1 h-1 rounded-full bg-purple-400" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Credits widget */}
      <div className="px-3 pb-3">
        <div className="rounded-xl border border-[#1f2937] bg-gradient-to-br from-purple-500/[0.06] to-blue-500/[0.04] p-4 relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-medium text-zinc-300">Credits</span>
              <span className="text-[11px] text-zinc-500">
                {mockUser.credits}/{mockUser.creditsMax}
              </span>
            </div>
            <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-400 to-blue-400 rounded-full"
                style={{ width: `${(mockUser.credits / mockUser.creditsMax) * 100}%` }}
              />
            </div>
            <button className="mt-3 w-full text-[12px] py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-zinc-200 transition-colors">
              Upgrade plan
            </button>
          </div>
        </div>
      </div>

      {/* Bottom nav */}
      <div className="px-3 pb-3 space-y-0.5 border-t border-[#141821] pt-3">
        {bottomItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.name}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[14px] text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200 transition-all"
            >
              <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
              <span className="font-medium">{item.name}</span>
            </button>
          );
        })}
      </div>

      {/* User */}
      <div className="px-3 pb-4">
        <button className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.03] transition-colors">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center text-[13px] font-semibold shadow-md shadow-purple-500/20 shrink-0">
            {mockUser.avatar}
          </div>
          <div className="flex-1 text-left min-w-0">
            <div className="text-[13px] font-medium text-white truncate">{mockUser.name}</div>
            <div className="text-[11px] text-zinc-500 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {mockUser.plan}
            </div>
          </div>
          <ChevronsUpDown className="w-4 h-4 text-zinc-500 shrink-0" strokeWidth={2} />
        </button>
      </div>
    </aside>
  );
}

/* ============================================================
 * Topbar.tsx
 * ============================================================ */

function Topbar() {
  return (
    <div className="sticky top-0 z-10 border-b border-[#141821] bg-[#050505]/70 backdrop-blur-xl">
      <div className="flex items-center justify-between px-10 py-4">
        <div className="flex items-center gap-3 flex-1 max-w-xl">
          <div className="relative flex-1">
            <Search
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none"
              strokeWidth={2}
            />
            <input
              type="text"
              placeholder="Search projects, avatars, templates..."
              className="w-full pl-10 pr-4 py-2 bg-white/[0.03] border border-[#1f2937] rounded-lg text-[13px] placeholder:text-zinc-500 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-zinc-500 bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded">
              ⌘K
            </kbd>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="relative p-2 rounded-lg hover:bg-white/[0.04] transition-colors">
            <Bell className="w-[18px] h-[18px] text-zinc-400" strokeWidth={1.75} />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-purple-400" />
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-b from-white/[0.08] to-white/[0.04] border border-white/[0.08] hover:from-white/[0.12] hover:to-white/[0.06] transition-all text-[13px] font-medium shadow-sm">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.25} />
            New project
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * ActionCard.tsx
 * ============================================================ */

interface ActionCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  gradient: string;
  badge?: string;
}

function ActionCard({ title, description, icon, gradient, badge }: ActionCardProps) {
  return (
    <button className="group relative text-left rounded-2xl border border-[#1f2937] bg-[#0a0a0b] p-6 overflow-hidden transition-all duration-300 hover:border-[#2d3748] lift grain">
      {/* Glow orb */}
      <div
        className={`absolute -top-20 -right-20 w-48 h-48 rounded-full ${gradient} blur-3xl opacity-40 group-hover:opacity-70 transition-opacity duration-500`}
      />

      {/* Inner highlight on hover */}
      <div
        className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 40%)',
        }}
      />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-6">
          <div className="w-11 h-11 rounded-xl glass flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
            {icon}
          </div>
          {badge && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/20">
              {badge}
            </span>
          )}
        </div>

        <h3 className="text-[15px] font-semibold text-white mb-1.5 tracking-tight">
          {title}
        </h3>
        <p className="text-[13px] text-zinc-400 leading-relaxed">{description}</p>

        <div className="mt-5 flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 group-hover:text-white transition-colors">
          <span>Get started</span>
          <ArrowRight
            className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform"
            strokeWidth={2}
          />
        </div>
      </div>
    </button>
  );
}

/* ============================================================
 * VideoCard.tsx
 * ============================================================ */

function VideoCard({ video }: { video: Video }) {
  return (
    <div className="group cursor-pointer">
      <div className="relative aspect-video rounded-xl overflow-hidden border border-[#1f2937] bg-[#0a0a0b] lift">
        {/* Gradient thumbnail */}
        <div
          className={`absolute inset-0 bg-gradient-to-br ${thumbnailGradients[video.thumbnail]}`}
        />

        {/* Noise overlay */}
        <div
          className="absolute inset-0 opacity-[0.15] mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          }}
        />

        {/* Hover darkening */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300" />

        {/* Play button on hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
          <div className="w-12 h-12 rounded-full glass-strong flex items-center justify-center shadow-xl scale-90 group-hover:scale-100 transition-transform duration-300">
            <Play className="w-4 h-4 text-white fill-white ml-0.5" strokeWidth={0} />
          </div>
        </div>

        {/* Duration chip */}
        <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-[11px] font-medium text-white border border-white/5">
          {video.duration}
        </div>

        {/* Status badge */}
        <div className="absolute top-2.5 left-2.5">
          <StatusBadge status={video.status} progress={video.progress} />
        </div>
      </div>

      {/* Title + meta */}
      <div className="mt-3 px-0.5">
        <h4 className="text-[13px] font-medium text-white truncate group-hover:text-purple-200 transition-colors">
          {video.title}
        </h4>
        <p className="text-[11px] text-zinc-500 mt-0.5">{video.createdAt}</p>
      </div>
    </div>
  );
}

/* ============================================================
 * StatusBadge.tsx
 * ============================================================ */

function StatusBadge({ status, progress }: { status: VideoStatus; progress?: number }) {
  const config = {
    Completed: {
      className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
      dot: 'bg-emerald-400',
      pulse: false,
    },
    Rendering: {
      className: 'bg-purple-500/15 text-purple-200 border-purple-500/25',
      dot: 'bg-purple-400',
      pulse: true,
    },
    Draft: {
      className: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/20',
      dot: 'bg-zinc-400',
      pulse: false,
    },
    Failed: {
      className: 'bg-rose-500/15 text-rose-300 border-rose-500/20',
      dot: 'bg-rose-400',
      pulse: false,
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold backdrop-blur-md border ${config.className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${config.pulse ? 'pulse-dot' : ''}`} />
      {status}
      {status === 'Rendering' && progress !== undefined && ` ${progress}%`}
    </span>
  );
}

/* ============================================================
 * Dashboard (main page)
 * ============================================================ */

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-[#050505] text-white relative">
      <Sidebar />

      <main className="ml-64 relative z-[1]">
        <Topbar />

        <div className="px-10 py-10 max-w-[1400px] fade-up">
          {/* Greeting */}
          <div className="mb-10">
            <div className="text-[13px] text-zinc-500 mb-1.5">
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </div>
            <h1 className="text-[32px] font-semibold tracking-tight leading-tight">
              Welcome back, {mockUser.name.split(' ')[0]}.
            </h1>
            <p className="text-[15px] text-zinc-400 mt-1.5">
              You have{' '}
              <span className="text-white font-medium">{mockUser.credits} credits</span>{' '}
              remaining this month.
            </p>
          </div>

          {/* Action cards */}
          <section className="mb-12">
            <h2 className="text-[13px] font-medium text-zinc-500 uppercase tracking-wider mb-4">
              Create
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <ActionCard
                title="Generate from Prompt"
                description="Describe your video in plain English. AI handles script, avatar, and voice."
                icon={<Sparkles className="w-5 h-5 text-purple-300" strokeWidth={1.75} />}
                gradient="bg-purple-500"
                badge="New"
              />
              <ActionCard
                title="Translate Video"
                description="Dub any video into 40+ languages with lip-sync accuracy in minutes."
                icon={<Globe className="w-5 h-5 text-blue-300" strokeWidth={1.75} />}
                gradient="bg-blue-500"
              />
              <ActionCard
                title="Digital Twin"
                description="Create a photoreal AI avatar of yourself from just 2 minutes of footage."
                icon={<UserPlus className="w-5 h-5 text-rose-300" strokeWidth={1.75} />}
                gradient="bg-rose-500"
              />
            </div>
          </section>

          {/* Recent Projects */}
          <section>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[13px] font-medium text-zinc-500 uppercase tracking-wider">
                Recent Projects
              </h2>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-[#1f2937]">
                  <button className="px-2.5 py-1 text-[12px] rounded-md bg-white/[0.06] text-white font-medium">
                    All
                  </button>
                  <button className="px-2.5 py-1 text-[12px] rounded-md text-zinc-400 hover:text-white transition-colors">
                    Completed
                  </button>
                  <button className="px-2.5 py-1 text-[12px] rounded-md text-zinc-400 hover:text-white transition-colors">
                    Drafts
                  </button>
                </div>
                <button className="text-[12px] text-zinc-400 hover:text-white transition-colors font-medium">
                  View all →
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {mockVideos.map((video) => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          </section>

          <div className="h-16" />
        </div>
      </main>
    </div>
  );
}
