import { useQuery } from "@tanstack/react-query";
import { fetchStatus } from "../api.js";
import { REMOVAL_ISSUE_URL, REPO_URL } from "../site.js";

const pct = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(1).replace(".", ",")} %`;
const interval = (ci: [number, number] | null | undefined): string =>
  ci ? ` (IC 95 % de Wilson: ${pct(ci[0])}–${pct(ci[1])})` : "";

const h2 = "mt-6 text-base font-semibold text-slate-900";
const p = "mt-2 text-sm leading-relaxed text-slate-700";

/** How the list is built and how good it is, in plain Spanish. The numbers come from the classifier registry. */
export function MethodPage() {
  const status = useQuery({ queryKey: ["status"], queryFn: fetchStatus, staleTime: 60_000 });
  const a = status.data?.acceptance;
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-slate-900">Método</h1>
      <p className={p}>
        RemoteFit muestra ofertas remotas de empresas de EE. UU. y globales{" "}
        <strong>a las que puedes postular desde tu país</strong>, con la frase de la oferta que lo
        demuestra. Es un proyecto personal y gratuito: no es una bolsa de empleo, no envía
        postulaciones y no pide datos personales.
      </p>

      <h2 className={h2}>De dónde salen las ofertas</h2>
      <p className={p}>
        Solo de las <strong>APIs públicas</strong> de tres sistemas de selección (Greenhouse, Lever
        y Ashby), para una lista de empresas revisada a mano. No se hace scraping de LinkedIn ni de
        otros sitios. Una tarea diaria trae las ofertas nuevas, cierra las que ya no están
        publicadas y vuelve a generar esta página.
      </p>

      <h2 className={h2}>Cómo se decide si puedes postular</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>
          Unas reglas descartan lo evidente (por ejemplo, ofertas presenciales o solo para EE. UU.).
        </li>
        <li>
          Un modelo de lenguaje de la capa gratuita de Gemini lee el texto público de la oferta y
          devuelve una etiqueta (Latinoamérica, global, países concretos, solo EE. UU., presencial o
          híbrida, o sin confirmar) junto con <strong>una cita textual</strong> que la respalda.
        </li>
        <li>
          Reglas de código revisan la respuesta: la cita debe aparecer en la oferta, y la ubicación
          que publica la empresa manda sobre frases genéricas.
        </li>
        <li>
          La decisión final para tu país la toma código simple: modalidad remota y una etiqueta que
          incluya tu país.
        </li>
      </ol>

      <h2 className={h2}>Qué tan confiable es</h2>
      {a && a.state !== "not_accepted" ? (
        <p className={p}>
          En el conjunto de prueba{a.testSet ? ` (${a.testSet})` : ""}, con ofertas que nadie había
          visto (144 ofertas, 92 aplicables desde Colombia), la versión en uso acertó en el{" "}
          <strong>{pct(a.precision)}</strong> de las ofertas que marcó como aplicables
          {interval(a.precisionCi)} y encontró el <strong>{pct(a.recall)}</strong> de las que sí lo
          eran{interval(a.recallCi)}.
        </p>
      ) : (
        <p className={p}>La versión en uso todavía no tiene una medición aceptada.</p>
      )}
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
        <li>
          <strong>Solo está medido para Colombia.</strong> Para los demás países el método es el
          mismo, pero la precisión no se ha medido.
        </li>
        <li>
          Las respuestas correctas del conjunto de prueba se etiquetaron{" "}
          <strong>con ayuda de un modelo de lenguaje</strong> (Claude), que leyó cada oferta
          completa y citó el texto; el dueño del proyecto revisó solo una muestra. La cifra mide qué
          tanto coincide el clasificador con esas etiquetas.
        </li>
        <li>
          Dos versiones anteriores no pasaron la meta (cerca de 91 % de precisión) en sus propios
          conjuntos de prueba, que luego se retiraron: cada versión se mide una sola vez, en ofertas
          que nunca vio, y la meta es al menos 95 % de precisión y 80 % de recall.
        </li>
      </ul>

      <h2 className={h2}>Verifica siempre en la oferta original</h2>
      <p className={p}>
        Cada tarjeta muestra la cita y el enlace a la oferta publicada por la empresa. Las
        condiciones pueden cambiar o el clasificador puede equivocarse:{" "}
        <strong>lee la oferta original antes de postular.</strong> Las ofertas que el clasificador
        no pudo confirmar están ocultas; puedes verlas con "Ver sin confirmar".
      </p>

      <h2 className={h2}>Pedir que se retire una oferta</h2>
      <p className={p}>
        Si representas a una empresa, o una oferta está mal clasificada, abre un{" "}
        <a
          className="text-sky-700 underline"
          href={REMOVAL_ISSUE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          issue en GitHub
        </a>{" "}
        con el enlace de la oferta. No hace falta enviar datos personales.
      </p>

      <p className="mt-6 text-xs text-slate-500">
        Código y documentación:{" "}
        <a className="underline" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          {REPO_URL.replace("https://", "")}
        </a>
      </p>
    </article>
  );
}
