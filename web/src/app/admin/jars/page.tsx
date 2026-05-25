import { JarManager } from "@/components/admin/JarManager";

export const metadata = {
  title: "jars — shithole admin",
  description:
    "Manage parameterised jar UTxOs: create, merge, and collect.",
};

/**
 * /admin/jars — admin-only management of the parameterised jar UTxOs at
 * the connected wallet's jar script address. Independent of the
 * marketplace UI flag — jars are a primitive used by any contract
 * (marketplace today, pit/p2p v2 tomorrow).
 */
export default function AdminJarsPage() {
  return <JarManager />;
}
