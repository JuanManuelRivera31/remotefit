/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "static" builds the published site (reads data/jobs.json); anything else talks to the local API. */
  readonly VITE_DATA_MODE?: string;
  /** Public repository URL, for the "retirar una oferta" link and the footer. */
  readonly VITE_REPO_URL?: string;
}
