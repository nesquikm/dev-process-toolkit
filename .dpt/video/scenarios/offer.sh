source .dpt/video/scenarios/_lib.sh
banner "📦  /ship-milestone, after the release commit"
mark offer
printf '\033[1mMake an explainer video for M_102cfa? [y/N]\033[0m '; sleep 0.9; type_out "y"; sleep 0.3
show "/video stored-video-style-and-merge-proof-guard" "bun run plugins/dev-process-toolkit/adapters/_shared/src/video_readiness.ts $(pwd)" 2.5
sleep 0.5; printf "\n"
