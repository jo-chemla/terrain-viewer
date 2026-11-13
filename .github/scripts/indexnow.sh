#!/usr/bin/env bash
# IndexNow: tells Bing (and Yandex, Seznam, Naver) which pages a deploy just
# changed, so they are recrawled in minutes instead of days. Google does not
# take part. The key is not a secret: it is served by the site itself at
# /<key>.txt (public/<key>.txt), which is how the engines check that the ping
# comes from the site's owner.
#
# Only the pages touched by the push are sent (the protocol asks for changed
# URLs, not the whole sitemap): the files changed between the previous head
# and this one come from the compare API, so no checkout is needed. A docs
# source file maps to its page, a public/*.html to itself, and anything that
# changes the app to the home page. Never fails the deploy.
#
# Env: GH_TOKEN, REPO (owner/name), BEFORE and AFTER (commit shas).
set -u
KEY=88c943f2620c29830b70a0e3a57f22bc
case "$REPO" in
  Iconem/terrain-viewer) HOST=terrain-viewer.iconem.com ;;
  jo-chemla/terrain-viewer) HOST=historical-satellite.iconem.com ;;
  *) echo "indexnow: no host for $REPO, skipped"; exit 0 ;;
esac
if [ -z "${BEFORE:-}" ] || [ "$BEFORE" = "0000000000000000000000000000000000000000" ]; then
  echo "indexnow: no previous commit to compare with, skipped"; exit 0
fi
files=$(gh api "repos/$REPO/compare/$BEFORE...$AFTER" --jq '.files[].filename' 2>/dev/null) || { echo "indexnow: compare failed, skipped"; exit 0; }
urls=$(printf '%s\n' "$files" | awk -v h="https://$HOST" '
  /^docs\/content\/docs\/.*\.mdx$/ { p=$0; sub(/^docs\/content\/docs\//,"",p); sub(/\.mdx$/,"",p); sub(/(^|\/)index$/,"",p); print h "/docs/" p (p==""?"":"/"); next }
  /^public\/[^\/]+\.html$/ { p=$0; sub(/^public/,"",p); print h p; next }
  /^(index\.html|components\/|lib\/|public\/)/ { print h "/" }
  /^CHANGELOG\.md$/ { print h "/docs/changelog/" }
' | sort -u | head -200)
if [ -z "$urls" ]; then echo "indexnow: no page changed"; exit 0; fi
body=$(printf '%s\n' "$urls" | jq -R . | jq -s --arg host "$HOST" --arg key "$KEY" '{host:$host, key:$key, keyLocation:("https://"+$host+"/"+$key+".txt"), urlList:.}')
code=$(curl -s -o /tmp/indexnow.out -w '%{http_code}' -X POST 'https://api.indexnow.org/indexnow' -H 'content-type: application/json; charset=utf-8' -d "$body" || echo 000)
echo "indexnow: $(printf '%s\n' "$urls" | wc -l) url(s) for $HOST, HTTP $code"
printf '%s\n' "$urls" | head -20
exit 0
