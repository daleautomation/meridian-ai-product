import { getSession } from "../lib/auth";
import WelcomePage from "../components/WelcomePage";

export default async function Page() {
  const user = await getSession();
  return <WelcomePage isAuthenticated={!!user} />;
}
