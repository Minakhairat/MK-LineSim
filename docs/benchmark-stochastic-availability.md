# Benchmark: stochastic failures, end-to-end availability (consistency evidence only)

Test: tests/benchmarkStochastic.test.ts. Single machine, cycle 300 s, exponential failure and repair,
MTBF 36000 s, MTTR 1800 s, arrivals every 250 s (machine nearly always busy), window T = 1,200,000 s,
seeds 1 to 30.

Metric per replication: 1 - resourceAnalytics[0].unplannedDowntimeSec / T (denominator is the full window).
Reference: MTBF / (MTBF + MTTR) = 36000 / 37800 = 0.952381.
Interval: mean +/- t * sd / sqrt(n), t = 2.045, n = 30.

Result (run 2026-11-24): mean 0.95034, half-width 0.00419, difference from reference 0.0020 (inside the interval).
Good units per seed were within [uptime/300 - failures, uptime/300].

Per seed (seed: availability / good units / failures):
1: 0.9354 / 3741 / 33; 2: 0.9647 / 3858 / 25; 3: 0.9511 / 3804 / 33; 4: 0.9514 / 3805 / 29;
5: 0.9561 / 3824 / 29; 6: 0.9437 / 3774 / 31; 7: 0.9306 / 3722 / 37; 8: 0.9203 / 3681 / 40;
9: 0.9451 / 3780 / 33; 10: 0.9378 / 3751 / 38; 11: 0.9520 / 3807 / 37; 12: 0.9413 / 3765 / 42;
13: 0.9394 / 3757 / 44; 14: 0.9395 / 3757 / 39; 15: 0.9608 / 3843 / 32; 16: 0.9667 / 3866 / 30;
17: 0.9495 / 3798 / 38; 18: 0.9617 / 3846 / 31; 19: 0.9558 / 3823 / 34; 20: 0.9573 / 3829 / 32;
21: 0.9394 / 3757 / 40; 22: 0.9494 / 3797 / 47; 23: 0.9552 / 3820 / 26; 24: 0.9586 / 3834 / 27;
25: 0.9472 / 3788 / 37; 26: 0.9556 / 3822 / 29; 27: 0.9629 / 3851 / 44; 28: 0.9563 / 3825 / 29;
29: 0.9629 / 3851 / 36; 30: 0.9625 / 3849 / 26.

Limits: one machine, no workers, exponential distributions only. This is a consistency check of the engine
against an analytical value for this configuration. It is not validation against a real plant or a third-party tool.
Other recorded limits: the event log keeps only the first 25,000 events; a standing queue of about 12,000 waiting
units made one run over 100 s versus about 1 s with a short queue; processing times are deterministic.
