'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser, UserButton } from '@clerk/nextjs';
import {
  Home, FolderClosed, UserSquare2, Mic, Palette, BarChart3,
  Settings, HelpCircle, Play, X, Film,
} from 'lucide-react';

export interface UserProfileData {
  credits_balance: number;
  credits_lifetime_purchased: number;
  credits_lifetime_used: number;
  // 'team' kept as deprecated alias for any historical DB rows.
  // New code writes 'studio' (matches ROADMAP.md).
  subscription_tier: 'free' | 'creator' | 'pro' | 'studio' | 'team';
  subscription_status: string;
}

// Monthly credit allowance per tier — matches lib/flutterwave.ts PRICING.
// 'team' is a legacy alias for 'studio' that we keep so any DB rows from
// before the rename still display correctly.
function getMaxCreditsForTier(tier: string): number {
  switch (tier) {
    case 'creator': return 50;
    case 'pro': return 200;
    case 'studio': return 800;
    case 'team': return 800; // legacy alias
    default: return 5;
  }
}

function getTierLabel(tier: string): string {
  switch (tier) {
    case 'creator': return 'Creator';
    case 'pro': return 'Pro';
    case 'studio': return 'Studio';
    case 'team': return 'Studio'; // legacy alias
    default: return 'Free';
  }
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  profile: UserProfileData | null;
  // NEW: parent passes a handler to open the tier picker modal.
  // Optional so older callers don't break — falls back to a no-op.
  onUpgradeClick?: () => void;
}

export default function Sidebar({ open, onClose, profile, onUpgradeClick }: SidebarProps) {
  const { user } = useUser();
  const pathname = usePathname();
  const displayName = user?.fullName || user?.firstName || user?.username || 'Creator';

  const navItems = [
    { name: 'Home', icon: Home, href: '/', badge: null },
    { name: 'Rift Studio', icon: Film, href: '/studio', badge: 'NEW' },
    { name: 'Projects', icon: FolderClosed, href: '/projects', badge: null },
    { name: 'Avatars', icon: UserSquare2, href: '/avatars', badge: null },
    { name: 'Voices', icon: Mic, href: '#', badge: null },
    { name: 'Brand Kit', icon: Palette, href: '#', badge: null },
    { name: 'Analytics', icon: BarChart3, href: '#', badge: null },
  ];
  const bottomItems = [{ name: 'Settings', icon: Settings }, { name: 'Help', icon: HelpCircle }];

  const credits = profile?.credits_balance ?? 0;
  const tier = profile?.subscription_tier ?? 'free';
  const maxCredits = getMaxCreditsForTier(tier);
  const tierLabel = getTierLabel(tier);
  const progressPct = maxCredits > 0 ? Math.min(100, (credits / maxCredits) * 100) : 0;

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/studio') return pathname === '/studio' || pathname.startsWith('/studio/');
    if (href === '/projects') return pathname === '/projects' || pathname.startsWith('/projects/');
    if (href === '/avatars') return pathname === '/avatars' || pathname.startsWith('/avatars/');
    return false;
  };

  // Handler for the credits button. If parent didn't pass onUpgradeClick
  // (legacy callers), do nothing rather than throwing.
  const handleUpgradeClick = () => {
    if (onUpgradeClick) {
      onUpgradeClick();
      // On mobile, close the sidebar so the modal isn't hidden under it.
      if (typeof window !== 'undefined' && window.innerWidth < 1024) {
        onClose();
      }
    }
  };

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
        className={`fixed left-0 top-0 h-screen w-64 border-r border-[#141821] bg-[#07070a]/95 backdrop-blur-xl z-40 flex flex-col transition-transform duration-300 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        <div className="px-6 pt-6 pb-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="relative w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Play className="w-4 h-4 text-white fill-white" strokeWidth={0} />
            </div>
            <span className="text-[17px] font-semibold tracking-tight">Riftvid</span>
          </Link>
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
            const active = isActive(item.href);
            const isStudio = item.name === 'Rift Studio';
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[14px] transition-all duration-200 ${
                  active
                    ? 'bg-white/[0.06] text-white shadow-sm'
                    : 'text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200'
                } ${isStudio && !active ? 'hover:bg-purple-500/[0.06]' : ''}`}
              >
                <Icon
                  className={`w-[18px] h-[18px] ${
                    active ? 'text-purple-400' : isStudio ? 'text-purple-300/70' : ''
                  }`}
                  strokeWidth={1.75}
                />
                <span className="font-medium flex-1">{item.name}</span>
                {item.badge && (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-gradient-to-r from-purple-500/20 to-blue-500/20 text-purple-200 border border-purple-500/30">
                    {item.badge}
                  </span>
                )}
                {active && !item.badge && (
                  <span className="w-1 h-1 rounded-full bg-purple-400" />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 pb-3">
          <div className="rounded-xl border border-[#1f2937] bg-gradient-to-br from-purple-500/[0.06] to-blue-500/[0.04] p-4 relative overflow-hidden">
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-medium text-zinc-300">Credits</span>
                <span className="text-[11px] text-zinc-500">
                  {credits}
                  {maxCredits > 0 && ` / ${maxCredits}`}
                </span>
              </div>
              <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-400 to-blue-400 rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <button
                onClick={handleUpgradeClick}
                className="mt-3 w-full text-[12px] py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] active:bg-white/[0.10] border border-white/[0.06] text-zinc-200 transition-colors"
              >
                {credits === 0 ? 'Get more credits' : 'Upgrade plan'}
              </button>
            </div>
          </div>
        </div>
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
        <div className="px-3 pb-4">
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.03] transition-colors">
            <UserButton appearance={{ elements: { avatarBox: 'w-9 h-9 shadow-md shadow-purple-500/20' } }} />
            <div className="flex-1 text-left min-w-0">
              <div className="text-[13px] font-medium text-white truncate">{displayName}</div>
              <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {tierLabel}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

// === END OF FILE — if you can see this line, the file saved completely ===
