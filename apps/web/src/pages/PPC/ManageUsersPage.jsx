import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Lock, ShieldCheck, Users } from 'lucide-react';
import { usePermissions, useAuth } from '../../rbac';
import RolesTab from '../../features/rbac/RolesTab';

const MotionSpan = motion.span;
const MotionDiv = motion.div;
import UsersTab from '../../features/rbac/UsersTab';

// Manage Users — shell: header + tab Users | Roles (full-width desktop).
// Isi tab hidup di features/rbac (UsersTab / RolesTab); halaman ini hanya
// perpindahan tab + status read-only. Role paket: docs/planning/rbac-role-paket.md.
export default function ManageUsersPage() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { canWrite } = usePermissions();
  const reduce = useReducedMotion();
  const canManage = canWrite('manage_users');
  const [tab, setTab] = useState('users'); // 'users' | 'roles'

  const authHeaders = React.useMemo(() => ({
    'x-user-role': authUser?.roles || '',
    'x-user-id': authUser?.id ? String(authUser.id) : '',
  }), [authUser?.roles, authUser?.id]);

  const tabs = [
    { id: 'users', label: 'Users', icon: <Users size={16} aria-hidden="true" /> },
    { id: 'roles', label: 'Roles', icon: <ShieldCheck size={16} aria-hidden="true" /> },
  ];

  const contentVariants = {
    initial: { opacity: 0, y: reduce ? 0 : 6 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.16, ease: 'easeOut' } },
    exit: { opacity: 0, y: reduce ? 0 : -4, transition: { duration: 0.12 } },
  };

  return (
    <div className="min-h-screen bg-[#eef2f6] text-slate-800">
      {/* Header */}
      <div>
        {/* deslop-allow C5: sticky header blur — pola header aplikasi lain */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-3 md:px-6 xl:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/operations-hub')}
                aria-label="Back"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
              >
                <ArrowLeft size={18} />
              </button>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#90e0ef] bg-[#caf0f8] text-[#0077b6]">
                <Users size={20} />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-extrabold text-slate-950">Manage Users</h1>
                <p className="truncate text-xs font-semibold text-slate-500">Users, access packages &amp; per-feature control</p>
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 pb-3 md:px-6 xl:px-8">
            <div role="tablist" aria-label="Manage users sections" className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
              {tabs.map((t) => { const { id, label } = t;
                const active = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(id)}
                    className="relative inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-sm font-extrabold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00b4d8] motion-reduce:transition-none"
                  >
                    {active && (
                      <MotionSpan
                        layoutId="mu-tab-pill"
                        className="absolute inset-0 rounded-lg bg-[#caf0f8]"
                        transition={{ type: 'spring', damping: 32, stiffness: 380, mass: 0.8 }}
                      />
                    )}
                    <span className={`relative z-10 flex items-center gap-1.5 ${active ? 'text-[#0077b6]' : 'text-slate-400'}`}>
                      {t.icon}
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </header>
      </div>

      <main className="mx-auto w-full max-w-[1600px] px-4 py-5 md:px-6 xl:px-8">
        {!canManage && (
          <section className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            <Lock size={16} className="shrink-0" /> Read-only access — you can view users &amp; roles but cannot create, edit, or delete.
          </section>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <MotionDiv
            key={tab}
            variants={contentVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {tab === 'roles'
              ? <RolesTab key="roles" authHeaders={authHeaders} canManage={canManage} />
              : <UsersTab key="users" authHeaders={authHeaders} canManage={canManage} />}
          </MotionDiv>
        </AnimatePresence>
      </main>
    </div>
  );
}
