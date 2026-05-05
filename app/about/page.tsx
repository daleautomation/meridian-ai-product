import { getSession } from "../../lib/auth";
import AboutPage from "../../components/AboutPage";

export default async function About() {
  const user = await getSession();
  return <AboutPage isAuthenticated={!!user} />;
}
