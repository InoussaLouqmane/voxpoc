import { Link } from "react-router-dom";
import { useLanguage } from "../i18n";

export default function About() {
  const { t } = useLanguage();

  return (
    <div className="page">
      <div className="card aboutCard">
        <h1>{t("about.title")}</h1>

        <section className="aboutSection">
          <h2>{t("about.purposeTitle")}</h2>
          <p>{t("about.purposeBody")}</p>
        </section>

        <section className="aboutSection">
          <h2>{t("about.howTitle")}</h2>
          <p>{t("about.howBody")}</p>
        </section>

        <section className="aboutSection aboutConsent">
          <h2>{t("about.consentTitle")}</h2>
          <p>{t("about.consentBody")}</p>
        </section>

        <section className="aboutSection">
          <h2>{t("about.stackTitle")}</h2>
          <p>{t("about.stackBody")}</p>
        </section>

        <Link to="/" className="backLink">
          ← {t("about.backHome")}
        </Link>
      </div>
    </div>
  );
}
