# Likely jury / visitor questions — prepared answers

**Is this real RTA data?** Yes for historical metro ridership from RTA's public Dubai Pulse open data ([coverage dates]); event scenarios and attendance are labelled assumptions or synthetic.

**Why replay GITEX 2025, a past event?** It is the biggest recurring event on this corridor, right beside World Trade Centre station, and because it already happened its ridership can be used to check and calibrate the model. RTA's own transport data lab analysed the same event. Dubai Future Week 2026 is our forward-looking scenario. (GITEX 2026 moves to Expo City in December, off this corridor.)

**Does World Trade Centre really overload during GITEX?** Under our default assumptions it runs close to, but below, the comfort line at the expected scale. The answer hinges on how full trains already are when they arrive, so we show the crowd size at which it tips over for each assumption ([METRIC – break-point chart]) instead of picking the number that looks most dramatic. Ridership data settles it.

**How accurate is it?** On held-out weeks the forecast has MASE [METRIC] versus a seasonal baseline (below 1 means better than the baseline). Event days are harder: [METRIC]. We report both.

**How is this different from RTA's own AI bus network planner?** That focuses on network-level bus planning; EventFlow Twin focuses on short event surges and compares multimodal responses side by side. It's complementary.

**What stops the AI from making things up?** The AI never calculates numbers; a simulator does. A checker rejects any explanation containing a number not produced by a tool, and nothing is applied without human approval.

**What would you need to deploy it?** Live ridership and GTFS-realtime feeds, event-organiser attendance data, validated capacity values from operations, and a pilot on one event with RTA planners.

**Privacy?** Only station-hour aggregates. No card IDs or personal data.

**Next step?** A pilot calibration on a real past event with RTA data, and adding road sensor data for the road layer.
