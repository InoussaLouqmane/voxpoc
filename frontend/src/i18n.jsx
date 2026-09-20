import { createContext, useContext, useEffect, useState } from "react";

const translations = {
  fr: {
    nav: {
      home: "Accueil",
      about: "À propos",
    },
    hero: {
      title: "VoxPOC",
      subtitle: "Agent vocal IA sortant",
      lead: "Décrivez l'objet d'un appel, et un agent vocal IA le mène pour vous — par téléphone ou directement dans votre navigateur — puis vous livre un résumé structuré.",
    },
    tabs: {
      phone: "Appel téléphonique",
      browser: "Démo navigateur",
    },
    phone: {
      numberLabel: "Numéro de téléphone",
      numberPlaceholder: "+33612345678",
      objetLabel: "Objet de l'appel",
      objetPlaceholder: "Ex: confirmer un rendez-vous demain à 14h",
      submit: "Lancer l'appel",
      submitting: "Lancement...",
      inProgress: "Appel en cours...",
      callIdLabel: "ID d'appel :",
      summaryTitle: "Résumé de l'appel",
      reset: "Lancer un nouvel appel",
      missingBackendUrl: "VITE_BACKEND_URL n'est pas configurée.",
      genericCallError: "Échec du déclenchement de l'appel.",
      statusError: "Erreur lors de la récupération du statut.",
    },
    browser: {
      hint: "Pas de vrai appel téléphonique ici : ton micro/haut-parleurs jouent le rôle de l'interlocuteur, pour tester la conversation avec l'agent IA directement.",
      objetLabel: "Objet de l'appel",
      objetPlaceholder: "Ex: confirmer un rendez-vous demain à 14h",
      submit: "Démarrer la démo (autorise le micro)",
      connecting: "Connexion à l'agent...",
      active: "Conversation en cours — parle dans ton micro.",
      stop: "Terminer la démo",
      summaryTitle: "Résumé de la conversation",
      reset: "Nouvelle démo",
      missingBackendUrl: "VITE_BACKEND_URL n'est pas configurée.",
      sessionError: "Échec de la création de la session.",
      wsError: "Erreur de connexion WebSocket avec le backend.",
      agentLabel: "Agent",
      youLabel: "Toi",
    },
    about: {
      title: "À propos de VoxPOC",
      purposeTitle: "Objectif du projet",
      purposeBody:
        "VoxPOC est un projet de fin d'études (DN MADE Numérique) réalisé à Africa Design School, à Cotonou, Bénin. C'est une démonstration technique d'un agent vocal IA capable de mener un appel téléphonique sortant de façon autonome, à partir d'un objectif défini par l'utilisateur — par exemple confirmer un rendez-vous. Il s'agit d'un prototype académique, pas d'un produit commercial.",
      howTitle: "Fonctionnement",
      howBody:
        "L'utilisateur décrit l'objet d'un appel. Le système déclenche soit un véritable appel téléphonique sortant, soit une démonstration directement dans le navigateur (micro/haut-parleurs). Un agent vocal IA en temps réel mène la conversation en fonction de l'objectif fourni. À la fin de l'échange, un résumé structuré est généré automatiquement.",
      consentTitle: "Consentement et données",
      consentBody:
        "Ce projet est un prototype académique : aucune donnée personnelle réelle n'est collectée, les scénarios utilisés sont fictifs. Les appels téléphoniques ne sont passés que vers des numéros contrôlés par l'auteur du projet, ou avec le consentement explicite de la personne appelée. Aucune information sensible n'est conservée au-delà de la durée de la démonstration. La conception s'inspire des principes de protection des données de l'Autorité de Protection des Données à caractère Personnel du Bénin (APDP).",
      stackTitle: "Stack technique",
      stackBody: "Node.js, Express, WebSocket, Twilio Programmable Voice, Google Gemini Live API, React.",
      backHome: "Retour à l'accueil",
    },
    footer: "Projet académique — Africa Design School, Cotonou, Bénin",
  },
  en: {
    nav: {
      home: "Home",
      about: "About",
    },
    hero: {
      title: "VoxPOC",
      subtitle: "Outbound AI voice agent",
      lead: "Describe the purpose of a call, and an AI voice agent carries it out for you — by phone or directly in your browser — then hands you a structured summary.",
    },
    tabs: {
      phone: "Phone call",
      browser: "Browser demo",
    },
    phone: {
      numberLabel: "Phone number",
      numberPlaceholder: "+33612345678",
      objetLabel: "Purpose of the call",
      objetPlaceholder: "E.g. confirm an appointment tomorrow at 2pm",
      submit: "Start the call",
      submitting: "Starting...",
      inProgress: "Call in progress...",
      callIdLabel: "Call ID:",
      summaryTitle: "Call summary",
      reset: "Start a new call",
      missingBackendUrl: "VITE_BACKEND_URL is not configured.",
      genericCallError: "Failed to start the call.",
      statusError: "Error while fetching call status.",
    },
    browser: {
      hint: "No real phone call here: your microphone/speakers play the role of the person being called, so you can test the conversation with the AI agent directly.",
      objetLabel: "Purpose of the call",
      objetPlaceholder: "E.g. confirm an appointment tomorrow at 2pm",
      submit: "Start the demo (allow microphone access)",
      connecting: "Connecting to the agent...",
      active: "Conversation in progress — speak into your microphone.",
      stop: "End the demo",
      summaryTitle: "Conversation summary",
      reset: "New demo",
      missingBackendUrl: "VITE_BACKEND_URL is not configured.",
      sessionError: "Failed to create the session.",
      wsError: "WebSocket connection error with the backend.",
      agentLabel: "Agent",
      youLabel: "You",
    },
    about: {
      title: "About VoxPOC",
      purposeTitle: "Project purpose",
      purposeBody:
        "VoxPOC is a final-year academic project (DN MADE Numérique) built at Africa Design School, in Cotonou, Benin. It is a technical demonstration of an AI voice agent able to autonomously conduct an outbound phone call based on a goal defined by the user, such as confirming an appointment. This is an academic prototype, not a commercial product.",
      howTitle: "How it works",
      howBody:
        "The user describes the purpose of a call. The system either places a real outbound phone call, or runs a demo directly in the browser using the microphone and speakers. A real-time AI voice agent carries the conversation based on the given purpose. Once the call ends, a structured summary is generated automatically.",
      consentTitle: "Consent and data",
      consentBody:
        "This project is an academic prototype: no real personal data is collected, and every scenario used is fictional. Phone calls are only placed to numbers controlled by the project's author, or with the explicit consent of the person being called. No sensitive information is retained beyond the duration of the demo. The design is inspired by the data protection principles of Benin's data protection authority (APDP).",
      stackTitle: "Tech stack",
      stackBody: "Node.js, Express, WebSocket, Twilio Programmable Voice, Google Gemini Live API, React.",
      backHome: "Back to home",
    },
    footer: "Academic project — Africa Design School, Cotonou, Benin",
  },
};

const LanguageContext = createContext(null);

function getInitialLang() {
  try {
    const saved = localStorage.getItem("voxpoc_lang");
    if (saved === "fr" || saved === "en") return saved;
  } catch (err) {
    // ignore (private browsing, etc.)
  }
  return "fr";
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(getInitialLang);

  useEffect(() => {
    try {
      localStorage.setItem("voxpoc_lang", lang);
    } catch (err) {
      // ignore
    }
  }, [lang]);

  function t(path) {
    const value = path.split(".").reduce((acc, key) => acc?.[key], translations[lang]);
    return value ?? path;
  }

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}
