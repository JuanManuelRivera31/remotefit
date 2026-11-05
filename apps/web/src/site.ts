// Public links of the site. No personal contact: requests go through GitHub issues.
export const REPO_URL =
  import.meta.env.VITE_REPO_URL ?? "https://github.com/JuanManuelRivera31/remotefit";

/** Opens the "retirar una oferta" issue form (.github/ISSUE_TEMPLATE/retirar-oferta.yml). */
export const REMOVAL_ISSUE_URL = `${REPO_URL}/issues/new?template=retirar-oferta.yml`;
