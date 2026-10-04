// File: Gives workspace pages a shared heading, description, and optional action.
// Renders the page introduction and available primary action.
export default function PageIntro({ eyebrow = 'Your workspace', title, description, action }) {
  return <header className="page-intro"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{action}</header>;
}
