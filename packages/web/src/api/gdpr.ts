// ─── RGPD / GDPR: export & suppression de compte ─────────────────────────────
// Cascade de suppression réutilisée par l'admin ET le self-service utilisateur.
// Export = toutes les données personnelles au format JSON (droit à la portabilité).

import { db } from './database/index';
import * as schema from './database/schema';
import { eq } from 'drizzle-orm';

/** Supprime toutes les données d'une company (réutilisé par delete user). */
export async function purgeCompanyData(companyId: string): Promise<void> {
  const cid = companyId;
  await db.delete(schema.websitePages).where(eq(schema.websitePages.companyId, cid));
  await db.delete(schema.agentActivity).where(eq(schema.agentActivity.companyId, cid));
  await db.delete(schema.agentMemory).where(eq(schema.agentMemory.companyId, cid));
  await db.delete(schema.agentSkills).where(eq(schema.agentSkills.companyId, cid));
  await db.delete(schema.tasks).where(eq(schema.tasks.companyId, cid));
  await db.delete(schema.documents).where(eq(schema.documents.companyId, cid));
  await db.delete(schema.dailyReports).where(eq(schema.dailyReports.companyId, cid));
  await db.delete(schema.emails).where(eq(schema.emails.companyId, cid));
  await db.delete(schema.emailsInbox).where(eq(schema.emailsInbox.companyId, cid));
  await db.delete(schema.emailConfig).where(eq(schema.emailConfig.companyId, cid));
  await db.delete(schema.ads).where(eq(schema.ads.companyId, cid));
  await db.delete(schema.revenueEvents).where(eq(schema.revenueEvents.companyId, cid));
  await db.delete(schema.browserTasks).where(eq(schema.browserTasks.companyId, cid));
  await db.delete(schema.seoContent).where(eq(schema.seoContent.companyId, cid));
  await db.delete(schema.productImages).where(eq(schema.productImages.companyId, cid));
  await db.delete(schema.products).where(eq(schema.products.companyId, cid));
  await db.delete(schema.suppliers).where(eq(schema.suppliers.companyId, cid));
  await db.delete(schema.shippingConfig).where(eq(schema.shippingConfig.companyId, cid));
  await db.delete(schema.designAssets).where(eq(schema.designAssets.companyId, cid));
  await db.delete(schema.executionState).where(eq(schema.executionState.companyId, cid));
  await db.delete(schema.agentActions).where(eq(schema.agentActions.companyId, cid));
  await db.delete(schema.agents).where(eq(schema.agents.companyId, cid));
  await db.delete(schema.jobQueue).where(eq(schema.jobQueue.companyId, cid));
}

/** Suppression complète d'un utilisateur et de toutes ses companies. */
export async function purgeUserData(userId: string): Promise<{ companiesDeleted: number }> {
  const userCompanies = await db.select().from(schema.companies).where(eq(schema.companies.userId, userId)).all();
  for (const comp of userCompanies) {
    await purgeCompanyData(comp.id);
  }
  await db.delete(schema.companies).where(eq(schema.companies.userId, userId));
  await db.delete(schema.tokenTransactions).where(eq(schema.tokenTransactions.userId, userId));
  await db.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  return { companiesDeleted: userCompanies.length };
}

/** Export complet des données d'un utilisateur (portabilité RGPD). */
export async function exportUserData(userId: string): Promise<any> {
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return null;
  const { passwordHash, ...safeUser } = user as any; // on n'exporte JAMAIS le hash

  const companies = await db.select().from(schema.companies).where(eq(schema.companies.userId, userId)).all();
  const companyIds = companies.map((c) => c.id);

  const perCompany = await Promise.all(companyIds.map(async (cid) => ({
    company: companies.find((c) => c.id === cid),
    agents: await db.select().from(schema.agents).where(eq(schema.agents.companyId, cid)).all(),
    tasks: await db.select().from(schema.tasks).where(eq(schema.tasks.companyId, cid)).all(),
    documents: await db.select().from(schema.documents).where(eq(schema.documents.companyId, cid)).all(),
    emails: await db.select().from(schema.emails).where(eq(schema.emails.companyId, cid)).all(),
    emailsInbox: await db.select().from(schema.emailsInbox).where(eq(schema.emailsInbox.companyId, cid)).all(),
    websitePages: await db.select().from(schema.websitePages).where(eq(schema.websitePages.companyId, cid)).all(),
    products: await db.select().from(schema.products).where(eq(schema.products.companyId, cid)).all(),
  })));

  const tokenTransactions = await db.select().from(schema.tokenTransactions).where(eq(schema.tokenTransactions.userId, userId)).all();
  const notifications = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)).all();

  return {
    exportedAt: new Date().toISOString(),
    format: 'velbaz-gdpr-export-v1',
    user: safeUser,
    companies: perCompany,
    tokenTransactions,
    notifications,
  };
}
