import { LocationProvider, lazy, Route, Router, useLocation } from "preact-iso";
import { api } from "./api";
import { useAsync } from "./components";
import { InboxPage } from "./pages/inbox";
import { PantryPage } from "./pages/pantry";
import { RecipePage } from "./pages/recipe";
import { SearchPage } from "./pages/search";
import { TagsPage } from "./pages/tags";

// Sigma and the layout are large; load them only when the graph page opens.
const GraphPage = lazy(() => import("./pages/graph").then((m) => m.GraphPage));

function Nav() {
  const { path } = useLocation();
  const stats = useAsync(() => api.stats(), [path]);
  const link = (href: string, label: string, extra?: number) => (
    <a
      class={`link${(href === "/" ? path === "/" : path.startsWith(href)) ? " active" : ""}`}
      href={href}
    >
      {label}
      {extra ? <span class="badge">{extra}</span> : null}
    </a>
  );
  const s = stats.data;
  return (
    <nav class="nav">
      <a class="brand" href="/">
        <i /> pantrybase
      </a>
      {link("/", "Recipes")}
      {link("/pantry", "Pantry")}
      {link("/graph", "Graph")}
      {link("/inbox", "Inbox", s?.inbox.pending)}
      {link("/tags", "Tags")}
      <span class="spacer" />
      {s && (
        <span class="stat">
          {s.recipes} recipes · {s.ingredients} ingredients
          {s.needs_review ? ` · ${s.needs_review} to review` : ""}
        </span>
      )}
    </nav>
  );
}

export function App() {
  return (
    <LocationProvider>
      <Nav />
      <main>
        <Router>
          <Route path="/" component={SearchPage} />
          <Route path="/recipe/:slug" component={RecipePage} />
          <Route path="/pantry" component={PantryPage} />
          <Route path="/graph" component={GraphPage} />
          <Route path="/inbox" component={InboxPage} />
          <Route path="/tags" component={TagsPage} />
          <Route default component={SearchPage} />
        </Router>
      </main>
    </LocationProvider>
  );
}
