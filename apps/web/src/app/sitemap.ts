import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { GUIDES } from "@/lib/learn-content";
import { HELP_TOPICS } from "@/lib/help-topics";
import { RELEASES } from "@/content/releases";
import { PUBLIC_EXAMPLES } from "@/content/example-catalog";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes: MetadataRoute.Sitemap = [];

  // Home
  routes.push({
    url: `${SITE_URL}/en`,
  });

  // Learn landing & cite
  routes.push({
    url: `${SITE_URL}/en/learn`,
  });
  routes.push({
    url: `${SITE_URL}/en/learn/cite`,
  });

  // Public Learn Guides
  for (const guide of GUIDES) {
    routes.push({
      url: `${SITE_URL}/en/learn/guides/${guide.id}`,
    });
  }

  // Public Help Topics
  for (const topic of HELP_TOPICS) {
    routes.push({
      url: `${SITE_URL}/en/learn/${topic.id}`,
    });
  }

  // Examples catalogue & slugs
  routes.push({
    url: `${SITE_URL}/en/examples`,
  });
  for (const example of PUBLIC_EXAMPLES) {
    routes.push({
      url: `${SITE_URL}/en/examples/${example.slug}`,
      lastModified: new Date(example.reviewDate),
    });
  }

  // Public docs & institutional pages
  routes.push({
    url: `${SITE_URL}/en/validation`,
  });
  routes.push({
    url: `${SITE_URL}/en/principles`,
  });
  routes.push({
    url: `${SITE_URL}/en/cost-and-support`,
  });
  routes.push({
    url: `${SITE_URL}/en/license`,
  });
  routes.push({
    url: `${SITE_URL}/en/roadmap`,
  });
  routes.push({
    url: `${SITE_URL}/en/releases`,
    lastModified: new Date(RELEASES[0]!.date),
  });
  routes.push({
    url: `${SITE_URL}/en/contact`,
  });
  routes.push({
    url: `${SITE_URL}/en/terms`,
  });
  routes.push({
    url: `${SITE_URL}/en/privacy`,
  });

  // Five new SEO landing pages
  routes.push({
    url: `${SITE_URL}/en/dft-calculations`,
  });
  routes.push({
    url: `${SITE_URL}/en/gaussian-alternative`,
  });
  routes.push({
    url: `${SITE_URL}/en/homo-lumo-calculator`,
  });
  routes.push({
    url: `${SITE_URL}/en/pyscf-online`,
  });
  routes.push({
    url: `${SITE_URL}/en/quantum-espresso-online`,
  });
  routes.push({
    url: `${SITE_URL}/en/webmo-alternative`,
  });
  routes.push({
    url: `${SITE_URL}/en/xtb-online`,
  });
  routes.push({
    url: `${SITE_URL}/en/crest-conformer-search-online`,
  });

  return routes;
}
