#ifndef SWARMFIX_UWB_GNSS_SOLVER_H
#define SWARMFIX_UWB_GNSS_SOLVER_H

#ifdef _WIN32
#define SWARMFIX_API __declspec(dllexport)
#else
#define SWARMFIX_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define SWARMFIX_UWB_GNSS_SOLVER_ABI_VERSION 1

typedef enum SwarmfixUwbGnssStatus {
    SWARMFIX_UWB_GNSS_OK = 0,
    SWARMFIX_UWB_GNSS_INVALID_ARGUMENT = 1,
    SWARMFIX_UWB_GNSS_ALLOCATION_FAILED = 2,
    SWARMFIX_UWB_GNSS_SINGULAR_SYSTEM = 3,
    SWARMFIX_UWB_GNSS_NUMERIC_FAILURE = 4
} SwarmfixUwbGnssStatus;

typedef struct SwarmfixUwbGnssProblem {
    int agent_count;
    int dimension;
    int uwb_count;
    int max_iterations;
    const double *gnss_positions;
    const double *gnss_sigmas;
    const int *uwb_source_indices;
    const int *uwb_target_indices;
    const double *uwb_distances;
    const double *uwb_sigmas;
    double *output_positions;
    double *output_cost_total;
    double *output_cost_gnss;
    double *output_cost_uwb;
    int *output_iterations;
} SwarmfixUwbGnssProblem;

SWARMFIX_API int swarmfix_uwb_gnss_abi_version(void);

SWARMFIX_API int swarmfix_solve_uwb_gnss(
    const SwarmfixUwbGnssProblem *problem);

SWARMFIX_API const char *swarmfix_uwb_gnss_status_message(int status);

#ifdef __cplusplus
}
#endif

#endif
