# Gygax Corpus — Access and Publication Architecture

**Status:** agreed direction, 5 September 2026, at corpus commit `188ee0a`
**Supersedes:** the first version of this record (`97409ba`), which framed the public
website as the primary consumer. That framing was wrong for the actual use case and is
replaced below.

## The correction

The first version reasoned from the website inward and concluded the next step was a
publication export. Reasoning from the actual use case outward gives a different answer.

The primary need is **research access** — the corpus available wherever the researcher is,
and usable by AI tools during research. That wants the full internal schema, live ingest,
schema evolution, provenance detail and FTS. Forcing it through a public publication
contract puts a layer between the researcher and their own data for no benefit.

**Public access is a separate, optional concern** with different requirements, and it is
the one that needs the stable contract.

## Four components, not three

```
canonical research store  →  private research service  →  private clients (UI, AI)
        (iMac)                    (iMac, read-only)         (Tailscale only)
                          ↘
                            optional public export  →  public website
```

| component | where | role |
|---|---|---|
| **Canonical research store** | iMac | repository, canonical SQLite, evidence tree, ingest and rebuild scripts, future packages. Authoritative. |
| **Private research service** | iMac, beside the database | controlled read-only operations over the corpus. The only thing that touches the DB. |
| **Private access plane** | Tailscale | reaches the service from other devices and from AI clients running on tailnet machines. Never public. |
| **Optional public export** | derived | the stable publication contract, built only if and when public access is wanted. |

## The website must not query the live database

Not even over Tailscale. That would couple the public site to a home machine, create
availability and security exposure, and turn a research workstation into production
infrastructure. Tailscale is appropriate for *private* access, not for anonymous traffic.

If public search is wanted later, the site consumes a **derived publication export**, never
the live internal database.

## Tailscale reachability is not model access

Worth stating explicitly because it is easy to assume otherwise: Tailscale solves network
reachability between authorised devices. It does **not** by itself make a private SQLite
file visible to a cloud-hosted model session. A hosted model cannot open a file on the
tailnet unless something on the researcher's side — a connector, local agent, or MCP-style
server — is running and exposing it.

That is why the research service is the load-bearing component rather than an optional
convenience: without it there is nothing for an AI client to talk to.

## Why a service rather than handing over the database file

Giving a model the raw SQLite would be simpler and worse:

- the internal schema can evolve behind a service, but not behind a shared file;
- read-only can be **enforced** rather than requested;
- evidence and provenance can be returned *with* results, so answers stay auditable;
- queries can be logged;
- later write operations (ingest, reconciliation) can be exposed separately, with
  stronger controls, rather than being implicit in file access;
- a model gets the corpus, not the rest of the filesystem.

### Operations the service should expose

Search testimony · fetch unit · retrieve context and prompts · retrieve evidence and
provenance · search by person, source or date · optionally bounded SQL.

Three properties matter more than the operation list:

1. **Uncertainty must survive the interface.** The corpus distinguishes verified from
   untranscribed, antecedent-based from label-derived, complete coverage from partial, and
   attested handles from personal identities. A service that flattened any of those would
   let an AI client produce confident claims the evidence does not support. The 223
   unresolved Stage A attributions are the test case: they must never be returned as
   though they met the antecedent standard.
2. **Every response carries the corpus state.** Content hash and repository commit, so an
   AI-generated research note records exactly which corpus state it rests on — the same
   property a public page would eventually need.
3. **A result can be walked back.** From a returned quotation to its testimony unit, and
   on to the evidence card and provenance locator.

### If bounded SQL is exposed

Read-only is necessary but not sufficient. The risk is not injection — it is a
pathological query exhausting the machine. Open the database read-only at the connection
level, and impose a row cap, a statement timeout, and a rejection path for malformed FTS5
syntax, which models produce routinely.

## What stays true from the first version

- Corrections are made **upstream in the evidence package** and the corpus rebuilt. Neither
  the service nor any site is a place where historical data is edited.
- The derived database is never hand-patched.
- Evidence assets are immutable, addressed by stable IDs; sha256 already serves.
- Plaintext SQLite and evidence originals stay gitignored; only encrypted artefacts are
  deployable; the passphrase never enters the repository or a deployed artefact.
- A public export, if built, must preserve the same distinctions and the same walk-back
  path, and be generated from a named corpus commit and content hash.

## Sequencing — and the step that comes before all of it

**The corpus does not yet live on the iMac.** It exists in an ephemeral container, with
the packages held outside it. This architecture describes a home the corpus does not
currently have.

So the order is:

1. **Get the corpus onto the iMac** — the package set, the repository at or after
   `188ee0a`, and the manifest. `scripts/gygax-v2-rebuild.sh` then reconstructs the
   canonical state there, which is also the external preservation copy. One action
   discharges both needs.
2. **Build the read-only research service** beside it.
3. **Private UI over Tailscale**, if wanted — this may be what the "hidden website
   section" was really for, with cleaner boundaries.
4. **Public export and site**, only if and when public access is wanted.

The three queued sources — A&E July 1975, Ward's "Gary Gygax Things", ENWorld Page 39 —
are ordinary expansion and depend on none of this.
