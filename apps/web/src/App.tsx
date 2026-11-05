import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Route, Routes } from "react-router";
import { fetchStatus } from "./api.js";
import { APP_NAME } from "./app-name.js";
import { SiteFooter, StaleDataNotice } from "./components/SiteFooter.js";
import { StatusBanner } from "./components/StatusBanner.js";
import { JobDetailPage } from "./pages/JobDetailPage.js";
import { JobsPage } from "./pages/JobsPage.js";
import { MethodPage } from "./pages/MethodPage.js";

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "font-semibold text-slate-900" : "text-sky-700 hover:underline";

export function App() {
  const status = useQuery({ queryKey: ["status"], queryFn: fetchStatus, staleTime: 60_000 });
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <StatusBanner status={status.data} />
      <StaleDataNotice status={status.data} now={new Date()} />
      <header className="mx-auto max-w-3xl px-4 pt-4">
        <div className="flex items-baseline justify-between gap-4">
          <Link to="/" className="text-lg font-bold">
            {APP_NAME}
          </Link>
          <nav className="flex gap-4 text-sm" aria-label="Secciones">
            <NavLink to="/" end className={navClass}>
              Ofertas
            </NavLink>
            <NavLink to="/metodo" className={navClass}>
              Método
            </NavLink>
          </nav>
        </div>
        <p className="text-sm text-slate-600">
          Ofertas remotas a las que puedes postular desde tu país, con la cita que lo demuestra.
        </p>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-4">
        <Routes>
          <Route path="/" element={<JobsPage />} />
          <Route path="/ofertas/:id" element={<JobDetailPage />} />
          <Route path="/metodo" element={<MethodPage />} />
          <Route path="*" element={<p className="text-sm">Página no encontrada.</p>} />
        </Routes>
      </main>
      <SiteFooter status={status.data} />
    </div>
  );
}
