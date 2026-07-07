cmake_minimum_required(VERSION 3.16)

project(swarmfix_uwb_gnss_solver C)

add_library(swarmfix_uwb_gnss_solver SHARED
    src/swarmfix_uwb_gnss_solver.c
)

target_include_directories(swarmfix_uwb_gnss_solver
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

set_target_properties(swarmfix_uwb_gnss_solver
    PROPERTIES
        C_STANDARD 99
        C_STANDARD_REQUIRED ON
        OUTPUT_NAME swarmfix_uwb_gnss_solver
)
