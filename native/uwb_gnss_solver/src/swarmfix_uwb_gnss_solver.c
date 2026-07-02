#include "swarmfix_uwb_gnss_solver.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

static int has_invalid_problem(const SwarmfixUwbGnssProblem *problem) {
    int index;

    if (problem == NULL) {
        return 1;
    }
    if (problem->agent_count <= 0 || problem->dimension <= 0) {
        return 1;
    }
    if (problem->uwb_count < 0 || problem->max_iterations <= 0) {
        return 1;
    }
    if (problem->gnss_positions == NULL || problem->gnss_sigmas == NULL) {
        return 1;
    }
    if (problem->output_positions == NULL || problem->output_cost_total == NULL) {
        return 1;
    }
    if (problem->output_cost_gnss == NULL || problem->output_cost_uwb == NULL) {
        return 1;
    }
    if (problem->output_iterations == NULL) {
        return 1;
    }
    if (problem->uwb_count > 0) {
        if (problem->uwb_source_indices == NULL || problem->uwb_target_indices == NULL) {
            return 1;
        }
        if (problem->uwb_distances == NULL || problem->uwb_sigmas == NULL) {
            return 1;
        }
    }
    for (index = 0; index < problem->agent_count; ++index) {
        if (problem->gnss_sigmas[index] <= 0.0) {
            return 1;
        }
    }
    for (index = 0; index < problem->uwb_count; ++index) {
        if (problem->uwb_source_indices[index] < 0
                || problem->uwb_source_indices[index] >= problem->agent_count) {
            return 1;
        }
        if (problem->uwb_target_indices[index] < 0
                || problem->uwb_target_indices[index] >= problem->agent_count) {
            return 1;
        }
        if (problem->uwb_source_indices[index] == problem->uwb_target_indices[index]) {
            return 1;
        }
        if (problem->uwb_distances[index] <= 0.0 || problem->uwb_sigmas[index] <= 0.0) {
            return 1;
        }
    }
    return 0;
}

static void zero_array(double *values, int count) {
    int index;

    for (index = 0; index < count; ++index) {
        values[index] = 0.0;
    }
}

static double compute_cost(const SwarmfixUwbGnssProblem *problem,
                           const double *positions,
                           double *cost_gnss,
                           double *cost_uwb) {
    int agent_index;
    int dimension_index;
    int link_index;
    int dimension = problem->dimension;
    double gnss_cost = 0.0;
    double uwb_cost = 0.0;

    for (agent_index = 0; agent_index < problem->agent_count; ++agent_index) {
        double inv_sigma = 1.0 / problem->gnss_sigmas[agent_index];
        for (dimension_index = 0; dimension_index < dimension; ++dimension_index) {
            int variable_index = agent_index * dimension + dimension_index;
            double residual = (positions[variable_index]
                    - problem->gnss_positions[variable_index]) * inv_sigma;
            gnss_cost += residual * residual;
        }
    }

    for (link_index = 0; link_index < problem->uwb_count; ++link_index) {
        int source = problem->uwb_source_indices[link_index];
        int target = problem->uwb_target_indices[link_index];
        double squared_distance = 0.0;
        double distance;
        double residual;

        for (dimension_index = 0; dimension_index < dimension; ++dimension_index) {
            double difference = positions[source * dimension + dimension_index]
                    - positions[target * dimension + dimension_index];
            squared_distance += difference * difference;
        }
        distance = sqrt(squared_distance);
        residual = (distance - problem->uwb_distances[link_index])
                / problem->uwb_sigmas[link_index];
        uwb_cost += residual * residual;
    }

    *cost_gnss = gnss_cost;
    *cost_uwb = uwb_cost;
    return gnss_cost + uwb_cost;
}

static int add_uwb_terms(const SwarmfixUwbGnssProblem *problem,
                         const double *positions,
                         double *normal_matrix,
                         double *gradient,
                         double *cost_uwb) {
    int link_index;
    int dimension = problem->dimension;
    int variable_count = problem->agent_count * problem->dimension;

    for (link_index = 0; link_index < problem->uwb_count; ++link_index) {
        int source = problem->uwb_source_indices[link_index];
        int target = problem->uwb_target_indices[link_index];
        double squared_distance = 0.0;
        double distance;
        double residual;
        double inv_sigma = 1.0 / problem->uwb_sigmas[link_index];
        int row_index;
        int column_index;

        for (row_index = 0; row_index < dimension; ++row_index) {
            double difference = positions[source * dimension + row_index]
                    - positions[target * dimension + row_index];
            squared_distance += difference * difference;
        }
        distance = sqrt(squared_distance);
        residual = (distance - problem->uwb_distances[link_index]) * inv_sigma;
        *cost_uwb += residual * residual;

        if (distance < 1.0e-12) {
            continue;
        }

        for (row_index = 0; row_index < dimension; ++row_index) {
            int source_row = source * dimension + row_index;
            int target_row = target * dimension + row_index;
            double source_jacobian = (
                positions[source_row] - positions[target_row]) / distance * inv_sigma;
            double target_jacobian = -source_jacobian;

            gradient[source_row] += source_jacobian * residual;
            gradient[target_row] += target_jacobian * residual;

            for (column_index = 0; column_index < dimension; ++column_index) {
                int source_column = source * dimension + column_index;
                int target_column = target * dimension + column_index;
                double source_column_jacobian = (
                    positions[source_column] - positions[target_column])
                    / distance * inv_sigma;
                double target_column_jacobian = -source_column_jacobian;

                normal_matrix[source_row * variable_count + source_column]
                    += source_jacobian * source_column_jacobian;
                normal_matrix[source_row * variable_count + target_column]
                    += source_jacobian * target_column_jacobian;
                normal_matrix[target_row * variable_count + source_column]
                    += target_jacobian * source_column_jacobian;
                normal_matrix[target_row * variable_count + target_column]
                    += target_jacobian * target_column_jacobian;
            }
        }
    }
    return SWARMFIX_UWB_GNSS_OK;
}

static int build_normal_system(const SwarmfixUwbGnssProblem *problem,
                               const double *positions,
                               double *normal_matrix,
                               double *gradient,
                               double *cost_gnss,
                               double *cost_uwb) {
    int agent_index;
    int dimension_index;
    int variable_count = problem->agent_count * problem->dimension;

    zero_array(normal_matrix, variable_count * variable_count);
    zero_array(gradient, variable_count);
    *cost_gnss = 0.0;
    *cost_uwb = 0.0;

    for (agent_index = 0; agent_index < problem->agent_count; ++agent_index) {
        double inv_sigma = 1.0 / problem->gnss_sigmas[agent_index];
        double weighted_jacobian = inv_sigma;
        for (dimension_index = 0; dimension_index < problem->dimension; ++dimension_index) {
            int variable_index = agent_index * problem->dimension + dimension_index;
            double residual = (positions[variable_index]
                    - problem->gnss_positions[variable_index]) * inv_sigma;
            gradient[variable_index] += weighted_jacobian * residual;
            normal_matrix[variable_index * variable_count + variable_index]
                += weighted_jacobian * weighted_jacobian;
            *cost_gnss += residual * residual;
        }
    }
    return add_uwb_terms(problem, positions, normal_matrix, gradient, cost_uwb);
}

static int solve_linear_system(int size,
                               double *matrix,
                               double *rhs,
                               double *solution) {
    int pivot_index;
    int row_index;
    int column_index;

    for (pivot_index = 0; pivot_index < size; ++pivot_index) {
        int best_row = pivot_index;
        double best_value = fabs(matrix[pivot_index * size + pivot_index]);

        for (row_index = pivot_index + 1; row_index < size; ++row_index) {
            double candidate = fabs(matrix[row_index * size + pivot_index]);
            if (candidate > best_value) {
                best_value = candidate;
                best_row = row_index;
            }
        }
        if (best_value < 1.0e-14) {
            return SWARMFIX_UWB_GNSS_SINGULAR_SYSTEM;
        }
        if (best_row != pivot_index) {
            double rhs_swap = rhs[pivot_index];
            rhs[pivot_index] = rhs[best_row];
            rhs[best_row] = rhs_swap;
            for (column_index = pivot_index; column_index < size; ++column_index) {
                double matrix_swap = matrix[pivot_index * size + column_index];
                matrix[pivot_index * size + column_index]
                    = matrix[best_row * size + column_index];
                matrix[best_row * size + column_index] = matrix_swap;
            }
        }

        for (row_index = pivot_index + 1; row_index < size; ++row_index) {
            double factor = matrix[row_index * size + pivot_index]
                    / matrix[pivot_index * size + pivot_index];
            matrix[row_index * size + pivot_index] = 0.0;
            for (column_index = pivot_index + 1; column_index < size; ++column_index) {
                matrix[row_index * size + column_index]
                    -= factor * matrix[pivot_index * size + column_index];
            }
            rhs[row_index] -= factor * rhs[pivot_index];
        }
    }

    for (row_index = size - 1; row_index >= 0; --row_index) {
        double sum = rhs[row_index];
        for (column_index = row_index + 1; column_index < size; ++column_index) {
            sum -= matrix[row_index * size + column_index] * solution[column_index];
        }
        solution[row_index] = sum / matrix[row_index * size + row_index];
    }

    return SWARMFIX_UWB_GNSS_OK;
}

int swarmfix_uwb_gnss_abi_version(void) {
    return SWARMFIX_UWB_GNSS_SOLVER_ABI_VERSION;
}

int swarmfix_solve_uwb_gnss(const SwarmfixUwbGnssProblem *problem) {
    int variable_count;
    int iteration;
    int status = SWARMFIX_UWB_GNSS_OK;
    double *positions;
    double *trial_positions;
    double *normal_matrix;
    double *gradient;
    double *rhs;
    double *delta;
    double damping = 1.0e-6;
    double cost_gnss = 0.0;
    double cost_uwb = 0.0;
    double current_cost;

    if (has_invalid_problem(problem)) {
        return SWARMFIX_UWB_GNSS_INVALID_ARGUMENT;
    }

    variable_count = problem->agent_count * problem->dimension;
    positions = (double *)malloc((size_t)variable_count * sizeof(double));
    trial_positions = (double *)malloc((size_t)variable_count * sizeof(double));
    normal_matrix = (double *)malloc(
        (size_t)variable_count * (size_t)variable_count * sizeof(double));
    gradient = (double *)malloc((size_t)variable_count * sizeof(double));
    rhs = (double *)malloc((size_t)variable_count * sizeof(double));
    delta = (double *)malloc((size_t)variable_count * sizeof(double));
    if (positions == NULL || trial_positions == NULL || normal_matrix == NULL
            || gradient == NULL || rhs == NULL || delta == NULL) {
        free(positions);
        free(trial_positions);
        free(normal_matrix);
        free(gradient);
        free(rhs);
        free(delta);
        return SWARMFIX_UWB_GNSS_ALLOCATION_FAILED;
    }

    memcpy(positions, problem->gnss_positions, (size_t)variable_count * sizeof(double));
    current_cost = compute_cost(problem, positions, &cost_gnss, &cost_uwb);

    for (iteration = 0; iteration < problem->max_iterations; ++iteration) {
        double trial_cost;
        double trial_cost_gnss;
        double trial_cost_uwb;
        double delta_norm = 0.0;
        int index;

        status = build_normal_system(
            problem,
            positions,
            normal_matrix,
            gradient,
            &cost_gnss,
            &cost_uwb);
        if (status != SWARMFIX_UWB_GNSS_OK) {
            break;
        }
        for (index = 0; index < variable_count; ++index) {
            normal_matrix[index * variable_count + index] += damping;
            rhs[index] = -gradient[index];
            delta[index] = 0.0;
        }
        status = solve_linear_system(variable_count, normal_matrix, rhs, delta);
        if (status != SWARMFIX_UWB_GNSS_OK) {
            break;
        }

        for (index = 0; index < variable_count; ++index) {
            trial_positions[index] = positions[index] + delta[index];
            delta_norm += delta[index] * delta[index];
        }
        delta_norm = sqrt(delta_norm);
        trial_cost = compute_cost(
            problem,
            trial_positions,
            &trial_cost_gnss,
            &trial_cost_uwb);

        if (!isfinite(trial_cost)) {
            status = SWARMFIX_UWB_GNSS_NUMERIC_FAILURE;
            break;
        }
        if (trial_cost <= current_cost) {
            memcpy(positions, trial_positions, (size_t)variable_count * sizeof(double));
            if (fabs(current_cost - trial_cost) < 1.0e-12 || delta_norm < 1.0e-10) {
                current_cost = trial_cost;
                cost_gnss = trial_cost_gnss;
                cost_uwb = trial_cost_uwb;
                ++iteration;
                break;
            }
            current_cost = trial_cost;
            cost_gnss = trial_cost_gnss;
            cost_uwb = trial_cost_uwb;
            damping *= 0.3;
            if (damping < 1.0e-12) {
                damping = 1.0e-12;
            }
        } else {
            damping *= 10.0;
        }
    }

    if (status == SWARMFIX_UWB_GNSS_OK) {
        memcpy(problem->output_positions, positions,
               (size_t)variable_count * sizeof(double));
        current_cost = compute_cost(problem, positions, &cost_gnss, &cost_uwb);
        *problem->output_cost_total = current_cost;
        *problem->output_cost_gnss = cost_gnss;
        *problem->output_cost_uwb = cost_uwb;
        *problem->output_iterations = iteration;
    }

    free(positions);
    free(trial_positions);
    free(normal_matrix);
    free(gradient);
    free(rhs);
    free(delta);
    return status;
}

const char *swarmfix_uwb_gnss_status_message(int status) {
    switch (status) {
    case SWARMFIX_UWB_GNSS_OK:
        return "ok";
    case SWARMFIX_UWB_GNSS_INVALID_ARGUMENT:
        return "invalid argument";
    case SWARMFIX_UWB_GNSS_ALLOCATION_FAILED:
        return "allocation failed";
    case SWARMFIX_UWB_GNSS_SINGULAR_SYSTEM:
        return "singular normal system";
    case SWARMFIX_UWB_GNSS_NUMERIC_FAILURE:
        return "numeric failure";
    default:
        return "unknown status";
    }
}
