import { Link, Outlet } from "react-router-dom";
import { useLanguage } from "../i18n";

export default function Layout() {
  const { lang, setLang, t } = useLanguage();

  return (
    <div className="shell">
      <header className="siteHeader">
        <Link to="/" className="brand">
          VoxPOC
        </Link>

        <nav className="siteNav">
          <Link to="/">{t("nav.home")}</Link>
          <Link to="/about">{t("nav.about")}</Link>
        </nav>

        <div className="langSwitch">
          <button className={lang === "fr" ? "langBtn langActive" : "langBtn"} onClick={() => setLang("fr")}>
            FR
          </button>
          <button className={lang === "en" ? "langBtn langActive" : "langBtn"} onClick={() => setLang("en")}>
            EN
          </button>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="siteFooter">{t("footer")}</footer>
    </div>
  );
}
