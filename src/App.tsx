import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { AppShell } from './components/AppShell';
import { FeedbackProvider } from './components/overlay';
import { Button, Card, EmptyState, Loading } from './components/ui';
import Dashboard from './pages/admin/Dashboard';
import EmployeeDetail from './pages/admin/EmployeeDetail';
import Employees from './pages/admin/Employees';
import EventDetail from './pages/admin/EventDetail';
import Events from './pages/admin/Events';
import Finance from './pages/admin/Finance';
import Payroll from './pages/admin/Payroll';
import Requests from './pages/admin/Requests';
import Schedule from './pages/admin/Schedule';
import Settings from './pages/admin/Settings';
import TimeEntries from './pages/admin/TimeEntries';
import Login from './pages/Login';
import Register from './pages/Register';
import Clock from './pages/worker/Clock';
import MyHours from './pages/worker/MyHours';
import MyRequests from './pages/worker/MyRequests';
import MyShifts from './pages/worker/MyShifts';
import Profile from './pages/worker/Profile';

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Loading label="" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, userId, profile, error, signOut } = useAuth();
  if (loading) return <Splash />;
  if (!userId) return <Navigate to="/login" replace />;
  if (!profile)
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <Card className="max-w-md">
          <EmptyState
            title="No se encontró tu perfil"
            message={error ?? 'Tu usuario existe pero no tiene perfil en la base de datos. Comprueba que las migraciones de Supabase se han aplicado.'}
            action={<Button variant="secondary" onClick={signOut}>Cerrar sesión</Button>}
          />
        </Card>
      </div>
    );
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { loading, userId } = useAuth();
  if (loading) return <Splash />;
  if (userId) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireAdmin() {
  const { isAdmin } = useAuth();
  return isAdmin ? <Outlet /> : <Navigate to="/fichar" replace />;
}

function Home() {
  const { isAdmin } = useAuth();
  return <Navigate to={isAdmin ? '/resumen' : '/fichar'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <FeedbackProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/registro" element={<PublicOnly><Register /></PublicOnly>} />
            <Route element={<RequireAuth><AppShell /></RequireAuth>}>
              <Route index element={<Home />} />
              <Route element={<RequireAdmin />}>
                <Route path="resumen" element={<Dashboard />} />
                <Route path="personal" element={<Employees />} />
                <Route path="personal/:id" element={<EmployeeDetail />} />
                <Route path="fichajes" element={<TimeEntries />} />
                <Route path="turnos" element={<Schedule />} />
                <Route path="noches" element={<Events />} />
                <Route path="noches/:id" element={<EventDetail />} />
                <Route path="finanzas" element={<Finance />} />
                <Route path="nominas" element={<Payroll />} />
                <Route path="solicitudes" element={<Requests />} />
                <Route path="ajustes" element={<Settings />} />
              </Route>
              <Route path="fichar" element={<Clock />} />
              <Route path="mis-horas" element={<MyHours />} />
              <Route path="mis-turnos" element={<MyShifts />} />
              <Route path="mis-solicitudes" element={<MyRequests />} />
              <Route path="perfil" element={<Profile />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </FeedbackProvider>
    </BrowserRouter>
  );
}
