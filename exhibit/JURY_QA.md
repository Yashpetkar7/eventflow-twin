# Likely jury / visitor questions — prepared answers

**Is this real RTA data?** Yes for historical metro ridership from RTA's public Dubai Pulse open data ([coverage dates]); event scenarios and attendance are labelled assumptions or synthetic.

**How accurate is it?** On held-out weeks the forecast has MASE [METRIC] versus a seasonal baseline (below 1 means better than the baseline). Event days are harder: [METRIC]. We report both.

**How is this different from RTA's own AI bus network planner?** That focuses on network-level bus planning; EventFlow Twin focuses on short event surges and compares multimodal responses side by side. It's complementary.

**What stops the AI from making things up?** The AI never calculates numbers; a simulator does. A checker rejects any explanation containing a number not produced by a tool, and nothing is applied without human approval.

**What would you need to deploy it?** Live ridership and GTFS-realtime feeds, event-organiser attendance data, validated capacity values from operations, and a pilot on one event with RTA planners.

**Privacy?** Only station-hour aggregates. No card IDs or personal data.

**Next step?** A pilot calibration on a real past event with RTA data, and adding road sensor data for the road layer.
