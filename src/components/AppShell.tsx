import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  CalendarCheck,
  CalendarDays,
  Clock,
  Ellipsis,
  FileText,
  Fingerprint,
  Inbox,
  LayoutGrid,
  LogOut,
  MessageSquare,
  PartyPopper,
  Receipt,
  Settings,
  Sofa,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth';
import { api } from '../lib/api';
import { APP_NAME, IS_DEMO } from '../lib/config';
import { cx, fullName } from '../lib/utils';
import { PushPrompt } from './NotificationsCard';
import { Modal } from './overlay';
import { Avatar } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

export function Logo({ size = 32 }: { size?: number }) {
  return <img src="/icon.svg" alt="" width={size} height={size} className="shrink-0 rounded-[22%] shadow-sm" />;
}

/** Evento para avisar al menú de que han cambiado los turnos del trabajador */
export const SHIFTS_CHANGED = 'vizzio:shifts-changed';
/** Evento para avisar al menú de que el trabajador ha leído o respondido un mensaje */
export const MESSAGES_CHANGED = 'vizzio:messages-changed';

export function AppShell() {
  const { profile, employee, isAdmin, isRrpp, isTray, signOut } = useAuth();
  const [pending, setPending] = useState(0);
  const [unanswered, setUnanswered] = useState(0);
  const [shiftsTick, setShiftsTick] = useState(0);
  const [inbox, setInbox] = useState(0);
  const [staffReplies, setStaffReplies] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAdmin) return;
    api.requests.list({ eq: { status: 'pending' } }).then((r) => setPending(r.length)).catch(() => {});
  }, [isAdmin, location.pathname]);

  // Turnos próximos que el trabajador aún no ha aceptado ni rechazado (se recuenta al responder uno)
  useEffect(() => {
    const onChange = () => setShiftsTick((t) => t + 1);
    window.addEventListener(SHIFTS_CHANGED, onChange);
    window.addEventListener(MESSAGES_CHANGED, onChange);
    return () => {
      window.removeEventListener(SHIFTS_CHANGED, onChange);
      window.removeEventListener(MESSAGES_CHANGED, onChange);
    };
  }, []);

  // Mensajes sin leer, tareas sin responder y conversaciones con respuestas nuevas de la administración
  useEffect(() => {
    if (isAdmin || !employee) return;
    (async () => {
      const rows = await api.messageRecipients.list({ eq: { employee_id: employee.id }, order: ['created_at', 'desc'], limit: 200 });
      const open = rows.filter((r) => !r.read_at || !r.response);
      const [tasks, replies] = await Promise.all([
        open.length
          ? api.messages.list({ in: ['id', open.map((r) => r.message_id)] }).then((ms) => new Set(ms.filter((m) => m.kind === 'task').map((m) => m.id)))
          : new Set<string>(),
        rows.length
          ? api.messageReplies.list({ in: ['recipient_id', rows.map((r) => r.id)], eq: { from_admin: true, read_at: null } }).catch(() => [])
          : [],
      ]);
      const withReply = new Set(replies.map((r) => r.recipient_id));
      setInbox(rows.filter((r) => !r.read_at || (tasks.has(r.message_id) && !r.response) || withReply.has(r.id)).length);
    })().catch(() => {});
  }, [isAdmin, employee?.id, location.pathname, shiftsTick]);

  // Administración: respuestas de los trabajadores sin leer
  useEffect(() => {
    if (!isAdmin) return;
    api.messageReplies
      .list({ eq: { from_admin: false, read_at: null } })
      .then((r) => setStaffReplies(r.length))
      .catch(() => {});
  }, [isAdmin, location.pathname, shiftsTick]);
  useEffect(() => {
    if (isAdmin || isRrpp || !employee) return;
    api.shifts
      .list({ eq: { employee_id: employee.id }, gte: ['start_at', new Date().toISOString()] })
      .then((list) => setUnanswered(list.filter((s) => s.status !== 'cancelled' && !s.response).length))
      .catch(() => {});
  }, [isAdmin, isRrpp, employee?.id, location.pathname, shiftsTick]);

  useEffect(() => setMoreOpen(false), [location.pathname]);

  // Dentro de la app el tema es siempre oscuro, a juego con la foto de fondo
  useEffect(() => {
    document.documentElement.classList.add('theme-dark');
    return () => document.documentElement.classList.remove('theme-dark');
  }, []);

  const sections: NavSection[] = isAdmin
    ? [
        { items: [{ to: '/resumen', label: 'Resumen', icon: LayoutGrid }] },
        {
          title: 'Equipo',
          items: [
            { to: '/personal', label: 'Personal', icon: Users },
            { to: '/fichajes', label: 'Fichajes', icon: Clock },
            { to: '/turnos', label: 'Turnos', icon: CalendarDays },
            { to: '/mensajes', label: 'Mensajes', icon: MessageSquare, badge: staffReplies },
            { to: '/disponibilidad', label: 'Disponibilidad', icon: CalendarCheck },
            { to: '/solicitudes', label: 'Solicitudes', icon: Inbox, badge: pending },
          ],
        },
        {
          title: 'Negocio',
          items: [
            { to: '/noches', label: 'Noches', icon: PartyPopper },
            { to: '/reservados', label: 'Reservados', icon: Sofa },
            { to: '/finanzas', label: 'Finanzas', icon: Wallet },
            { to: '/facturas', label: 'Facturas', icon: FileText },
            { to: '/nominas', label: 'Nóminas', icon: Receipt },
          ],
        },
        {
          title: 'Cuenta',
          items: [
            ...(employee ? [{ to: '/fichar', label: 'Mi fichaje', icon: Fingerprint }] : []),
            { to: '/ajustes', label: 'Ajustes', icon: Settings },
          ],
        },
      ]
    : [
        {
          items: [
            { to: '/fichar', label: 'Fichar', icon: Fingerprint },
            ...(isRrpp || isTray || employee?.manages_reservations ? [{ to: '/reservados', label: 'Reservados', icon: Sofa }] : []),
            { to: '/mis-horas', label: 'Mis horas', icon: Clock },
            ...(isRrpp ? [{ to: '/mis-mensajes', label: 'Mensajes', icon: MessageSquare, badge: inbox }] : []),
            // Los RRPP no tienen turnos, disponibilidad ni solicitudes
            ...(isRrpp
              ? []
              : [
                  { to: '/mis-turnos', label: 'Mis turnos', icon: CalendarDays, badge: unanswered },
                  { to: '/mis-mensajes', label: 'Mensajes', icon: MessageSquare, badge: inbox },
                  { to: '/mi-disponibilidad', label: 'Disponibilidad', icon: CalendarCheck },
                  { to: '/mis-solicitudes', label: 'Solicitudes', icon: Inbox },
                ]),
            { to: '/perfil', label: 'Perfil', icon: User },
          ],
        },
      ];

  const all = sections.flatMap((s) => s.items);
  const tabs: NavItem[] = isAdmin
    ? [
        all.find((i) => i.to === '/resumen')!,
        all.find((i) => i.to === '/personal')!,
        all.find((i) => i.to === '/fichajes')!,
        all.find((i) => i.to === '/finanzas')!,
        { to: '#more', label: 'Más', icon: Ellipsis, badge: pending + staffReplies },
      ]
    : all.length > 5
      ? [...all.slice(0, 4), { to: '#more', label: 'Más', icon: Ellipsis }]
      : all;
  const moreItems = all.filter((i) => !tabs.some((t) => t.to === i.to));
  const moreActive = moreItems.some((i) => location.pathname.startsWith(i.to));

  const displayName = employee ? fullName(employee) : profile?.full_name || profile?.email || 'Usuario';

  return (
    <div className="min-h-dvh">
      {/* Barra lateral (escritorio) */}
      <aside className="glass fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col border-r border-line lg:flex">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-6">
          <Logo size={34} />
          <div className="leading-tight">
            <div className="text-[17px] font-semibold tracking-tight">{APP_NAME}</div>
            <div className="text-[12px] text-ink-2">Staff & Finance</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {sections.map((s, i) => (
            <div key={i} className="mt-4 first:mt-1">
              {s.title && <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{s.title}</div>}
              {s.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cx(
                      'group flex h-9 items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium transition',
                      isActive ? 'bg-accent text-on-accent shadow-sm' : 'text-ink hover:bg-fill',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className={cx('h-[18px] w-[18px]', isActive ? 'text-on-accent' : 'text-accent')} strokeWidth={2} />
                      <span className="flex-1">{item.label}</span>
                      {!!item.badge && (
                        <span className={cx('tabular rounded-full px-1.5 text-[12px] font-semibold', isActive ? 'bg-on-accent/20' : 'bg-red text-white')}>
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          {IS_DEMO && (
            <div className="mb-2 rounded-[10px] bg-orange/15 px-3 py-2 text-[12px] font-medium text-orange">
              Modo demo · datos de ejemplo
            </div>
          )}
          <div className="flex items-center gap-3 rounded-[10px] px-2 py-1.5">
            <Avatar name={displayName} color={employee?.color ?? '#8e8e93'} src={employee?.photo_url} size={34} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[14px] font-medium">{displayName}</div>
              <div className="truncate text-[12px] text-ink-2">{isAdmin ? 'Administrador' : employee?.position ?? (isRrpp ? 'RRPP' : 'Trabajador')}</div>
            </div>
            <button
              onClick={async () => {
                await signOut();
                navigate('/login');
              }}
              className="grid h-8 w-8 place-items-center rounded-full text-ink-2 hover:bg-fill hover:text-ink"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-[17px] w-[17px]" />
            </button>
          </div>
        </div>
      </aside>

      {/* Contenido */}
      <div className="app-bg" aria-hidden />
      <main className="app-glass lg:pl-[260px]">
        {IS_DEMO && (
          <div className="bg-orange/15 px-4 pb-1.5 pt-[calc(env(safe-area-inset-top)+6px)] text-center text-[12px] font-medium text-orange lg:hidden">
            Modo demo · conecta Supabase para usar datos reales
          </div>
        )}
        <div className="mx-auto max-w-6xl px-4 pb-[calc(env(safe-area-inset-bottom)+96px)] pt-[calc(env(safe-area-inset-top)+20px)] sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
          {!isAdmin && employee && <PushPrompt />}
          <Outlet />
        </div>
      </main>

      {/* Barra de pestañas (móvil) */}
      <nav className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((t) => {
            const content = (active: boolean) => (
              <span className={cx('relative flex flex-col items-center gap-0.5 pb-1.5 pt-2', active ? 'text-accent' : 'text-ink-3')}>
                <t.icon className="h-[25px] w-[25px]" strokeWidth={active ? 2.2 : 1.8} />
                <span className="text-[10px] font-medium">{t.label}</span>
                {!!t.badge && (
                  <span className="tabular absolute left-1/2 top-1 ml-2 min-w-[18px] rounded-full bg-red px-1 text-center text-[11px] font-semibold leading-[18px] text-white">
                    {t.badge}
                  </span>
                )}
              </span>
            );
            if (t.to === '#more')
              return (
                <button key={t.to} onClick={() => setMoreOpen(true)}>
                  {content(moreActive)}
                </button>
              );
            return (
              <NavLink key={t.to} to={t.to}>
                {({ isActive }) => content(isActive)}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Más">
        <div className="divide-y divide-line overflow-hidden rounded-xl bg-fill/50">
          {moreItems.map((i) => (
            <NavLink key={i.to} to={i.to} className="flex items-center gap-3 px-4 py-3.5 text-[16px] font-medium">
              <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-accent text-on-accent">
                <i.icon className="h-[18px] w-[18px]" />
              </span>
              <span className="flex-1">{i.label}</span>
              {!!i.badge && <span className="tabular rounded-full bg-red px-2 text-[13px] font-semibold text-white">{i.badge}</span>}
            </NavLink>
          ))}
        </div>
        <button
          onClick={async () => {
            await signOut();
            navigate('/login');
          }}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-red/10 py-3 text-[16px] font-medium text-red"
        >
          <LogOut className="h-[18px] w-[18px]" /> Cerrar sesión
        </button>
      </Modal>
    </div>
  );
}
