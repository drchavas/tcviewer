Description of the Extended Best Track Files
--------------------------------------------

    Atlantic (ebtrk_atlc_1851_yyyy.txt, yyyy=most recent year available)

    Eastern North Pacific (ebtrk_epac_1949_yyyy.txt)

    Central North Pacific (ebtrk_cpac_1949_yyyy.txt)

    Data File Version 3.0.0  (March 1, 2021)


Summary of Changes in Version 3.0.0:
------------------------------------

1. Files extended back to beginning of NHC’s HURDAT2 files.

2. The Central Pacific Dataset file was added.

3. New data file format introduced, legacy format is
   also updated for continuity purposes.


Input Data Sources:
-------------------

    1. NHC Atlantic HURDAT2 Downloaded January 10, 2021:
            https://www.nhc.noaa.gov/data/
        
    2. East Pacific HURDAT2 Downloaded January 10, 2021:
            https://www.nhc.noaa.gov/data/ 
       
    3. ATCF a-deck and b-deck data downloaded from NHC FTP:
            https://ftp.nhc.noaa.gov/atcf/
        
    4. Data from the previous version of the Extended Best
       Track Dataset for 1988 - 2003



Project History:
----------------

    Current POCs: Galina Chirokova and Mark DeMaria, CIRA/CSU
    
    Major update in 2021 provided by:
    
        Galina Chirokova 
        CIRA/Colorado State University 
        West Laporte Avenue Fort Collins, CO 80523

    Updates Since 2014 Provided by CIRA/CSU Staff.

    Initially prepared by Mark DeMaria, Jermey Pennington and Krislyn Williams,
    formerly from the NCEP/National Hurricane Center.


Background Information: 
-----------------------

    The National Hurricane Center (NHC) maintains a climatology of all Atlantic
    tropical cyclones since 1851, East North Pacific Tropical Cyclones since 1950,
    and Central North Pacific Tropical Cyclones since 1949. For each storm, the
    data file contains estimates of the latitude, longitude, 1-minute maximum
    sustained surface winds, minimum sea-level pressure, and an indicator of
    whether the system was purely tropical, subtropical or extra-tropical at 6-hour
    intervals. This data set is sometimes referred to as HURDAT2.  One limitation
    of the HURDAT2 file is that it contains only limited information about the
    storm size. 

    As part of the operational forecasting procedure, NHC routinely estimates the
    radii of 34, 50 and 64 kt winds, the radius and pressure of the outermost
    closed isobar, the radius of maximum wind, and the diameter of the storm eye,
    if one exists. HURDAT2 includes 34, 50 and 64 kt winds for all 3 basins
    starting in 2004. However, HURDAT 2 does not include wind radii prior to 2004
    and also does not include the radius of maximum wind, and the diameter of the
    storm eye. Under original support from the Risk Prediction Initiative, this
    operational data for the period 1988-1997 was digitized and combined with the
    information from the HURDAT file. Although the RPI project was completed in
    1999, the files have been updated by NESDIS/STAR for development of satellite
    algorithms, using data supplied by NHC personnel. Starting in 2020 the database
    has been used my multiple CIRA tropical cyclone projects and the recent updates
    have been funded by the projects that currently use this dataset. 



Version History: 
----------------

    Version 1.0 - Feb 1998 - All variables for 1990-1997 
    
    Version 1.1 - Apr 1998 - All variables for 1988-1997 
                             except max wind radii for 
                             1988-1989
    
    Version 1.2 - Feb 1999 - All variables for 1988-1997
    
    Version 1.3 - Apr 2000 - All variables for 1988-1999 
    
    Version 1.4 - Mar 2001 - All variables for 1988-2000 
    
    Version 1.5 - Apr 2003 - All variables for 1988-2002, 
                             updated NHC Best Track file 
                             1988-2002 used, includes 
                             category 5 upgrade of 
                             Hurricane Andrew 1992 
    
    Version 1.6 - Feb 2004 - All variables for 1988-2003
    
    Version 1.7 - Mar 2007 - All variables for 1988-2006 
                             All changes to HURDAT as of 
                             March 2007 included.  
                             34, 50 and 64 kt wind radii 
                             since 2004 are from NHC 
                             Best Track. NHC began creating 
                             Best Track wind radii in 2004; 
                             Radii from 1988-2003 are still 
                             the operational radii. An East 
                             Pacific Extended Best Track was 
                             added in version 1.7 called: 
                             'ebtrk17_epac.txt', it includes 
                             the years 2001-2006.

    Version 1.8 - Feb 2008   Cases from 2007 season added.
    
    Version 1.9 - May 2009   Cases from 2008 season added. 
                             Some missing data from tropical 
                             storm Zeta (2005-06) added, 
                             storm numbers from 1997 modified 
                             for consistency with NHC numbering 
                             convention, minor changes to 
                             HURDAT since 2008 incorporated.
        
    Version 1.10 - Nov 2010  Cases from 2009 season added.
    
    Version 1.11 - Jun 2011  Cases from 2010 season added.
    
    Version 2.00 - Aug 2012  Cases from 2011 season added.
                             New field added to end of record 
                             showing distance to nearest major 
                             landmass (km).
                             
    Version 2.01 - Feb 2013  Cases from 2012 season added.
    
    Version 2.02 - Feb 2014  Cases from 2013 season added.
    
    Version 2.03 - Feb 2015  Cases from 2014 season added.
    
    Version 2.04 - Jul 2016  Cases from 2015 season added.
    
    Version 2.05 - Jan 2018  Cases from 2016 season added.
    
    Version 2.06 - Aug 2018  Cases from 2017 season added.
    
    Version 2.07 - Dec 2019  Cases from 2018 season added.
    
    Version 3.0.0– Mar 2021 - The existing databases have been 
                                verified using NHC’s ATCF data for 
                                1851 – 2019 and the most recent 
                                available HURRDAT2 database. 
                                In the updated version the radius 
                                and pressure of the outermost closed 
                                isobar, the radius of max wind, and 
                                the diameter of the storm eye are 
                                always taken from b-deck if b-deck 
                                values are available.
    Version 3.0.1- Aug 2021 - Data from the final NHC 2020 best track added
                            - A couple of minor errors corrected
                               - The incorrect eye diameter values in the 1998 IVAN TC case data 
                                    have been replaced with the corrected values.
                               - The EP062019 TC received updated RMW values for several time 
                                    periods that are now more accurate.
                               - The Extended Best Track Dataset documentation files have been 
                                    updated with new information pertinent to the 2020 season cases.
    Version 3.0.2- Oct 2022 - Data from the final NHC 2021 best track added
                            - Documentation updated 


    The radius and pressure of the outer closed isobar and the radius of maximum
    wind were not routinely estimated as part of the NHC operational forecast
    procedure prior to 1990. The outer closed isobar radii and pressures from
    1988-89 that were added in version 1.1 were estimated from the tropical surface
    analyses, which were prepared operationally by NHC. These surface analyses were
    extracted from the NHC microfilm archive and the radius and pressure were
    estimated manually by J. Pennington. The radius of maximum winds for 1988-89
    that were added in version 1.2 were obtained from the vortex messages of
    aircraft reconnaissance missions. These values were smoothed in time (the
    nearest three observations were averaged) to give the estimates included in the
    extended best track data file. The wind radii for this period (1988-89) are
    only included for cases where aircraft data was available.

    All of the parameters not available in the HURDAT2 file were estimated from
    operational data sources, including ship and other surface reports, aircraft
    reconnaissance data and satellite imagery. At present, there are no error
    estimates for these variables. Generally speaking, these parameters are more
    reliable west of 55 longitude, where aircraft reconnaissance data is usually
    available. Also, because the data is operational, there is no guarantee that
    all of the parameters are consistent. For example, the radius of 50 kt winds
    might be smaller than the radius of 64 kt winds, even though this arrangement
    is not physically possible. Note that in version 1.7 and higher the wind radii
    are from the NHC best track for 2004 and later. 


-------------------------------------------------------------------------------
Original File Format Description (see below for description of the new format):
-------------------------------------------------------------------------------

    The extended best track file uses a simple ASCII format. There is one line of
    data for each date and time period (00, 06, 12 or 18 UTC) of each storm (see
    sample line listed below). The information is given in the following order:
    Storm identification number, storm name, month, day, time, year, latitude (deg
    N), longitude (deg W), maximum wind speed (kt), minimum central pressure (hPa),
    radius of maximum wind speed (nm), eye diameter (nm), pressure of the outer
    closed isobar (hPa), radius of the outer closed isobar (nm), radii (nm) of 34
    kt wind to the NE, SE, SW and NW of the storm center, radii (nm) of 50 kt wind
    to the NE, SE, SW and NW, radii (nm) of 64 kt wind to the NE, SE, SW, NW, and a
    storm type code.  This code is either * for a tropical system (tropical
    depression, tropical storm, or hurricane), W for tropical wave, D for a
    tropical disturbance, S for a subtropical storm, E for an extra-tropical storm,
    or L for remnant low. The last record is the distance to the nearest major
    landmass (km), where the island of Trinidad is the smallest area considered to
    be land. Negative values indicate the storm center is over land. 

         Each item above is separated by a space in the file except the following:
    The month, day, and time are listed as one 6-digit number following the storm
    name.  For example, 06 UTC on July 10 would be listed as 071006. Also the 34,
    50, and 64-knot wind radii are separated from one another, but the radii for
    the four directions (NE, SE, SW, NW) are grouped together (12 characters). If
    any of these radii are less than 100 nm, a space will occur within the
    grouping. Thus, a wind radii group 125 25100100 indicates that winds at the
    given speed occur 125 nm to the NE, 25 nm to the SE, 100 nm to the SW, and 100
    nm to the NW of the storm center. The following is a complete line of text from
    the extended best track file:

    AL0290 ARTHUR    072518 1990 13.1  63.7  60  995  30 -99 1012 180  60 60 60 60
    30  0  0 30   0  0  0  0 *   267.

    A -99 in any parameter is a default value that means no estimate was available. 


-------------------------------------------
New File Format and Major Updates for 2021:
-------------------------------------------

    Multiple changes have been made in 2021, specifically:

        1. Atlantic and Eastern North Pacific Databases have been extended to use
            all data available in NHC databases, starting with 1851 in the Atlantic and
            1949 in the Eastern North Pacific; 

        2. Central North Pacific database for the years 1949 – 2019 has been added; 

        3. For the 1988 – 2003 the wind radii for 34, 50, and 64 knots are not
            available in HURDAT2. In some cases those values are available in ATCF a-deck
            files. The old version of the Extended Best Track data contained wind radii for
            1988 – 2003. In many cases data in the Extended Best Track include wind radii
            not available in a-decks. In the updated version we preserved all wind radii
            data available in the old Extended Best Track data.  Note that some of those
            values could be different from wind radii available for 1988 – 2003 in a-deck
            files.  

        4. For 2004 – 2019 wind radii for 34, 50, and 64 knots were obtained from
            HURDAT2. The same wind radii are also available in post-season ATCF b-deck
            files; 

        5. For radius or maximum wind, eye diameter, and radius and pressure of the
            outer closed isobar multiple sources were used. The b-deck values were used
            when available. If a variable is not provided in b-deck, then a-deck value from
            the CARQ line is used. If neither b- or a-deck CARQ values are available, then
            values are taken from the OFCL line in the a-deck at t = 0, and then next from
            OFCL at t = 3 h. Finally, if none of the previous sources are available, the
            data are taken from the old Extended Best Track. In most cases data from the
            old Extended Best Track were used prior to 2004, and values from ATCF for 2004
            and later data.  

        6. A new column, after the DTL has been added to indicate the source of data
            for radius of maximum wind speed (nmi), eye diameter (nmi), pressure of the
            outer closed isobar (hPa), radius of the outer closed isobar (nmi). The new
            column has 4 digits, corresponding to 4 variable. Each of the 4 digits, 0 –the
            corresponding variable has been obtained from b-deck file, 1 – from a-deck CARQ
            line, 2 – from OFCL at t = 0 h, 3 – from OFCL at t = 3 h, 4 – from the previous
            version of the Extended Best Track file, and 9 – variable is missing in all
            sources; 

        7. New storm types have been added to include all storm types available in ATCF
            and HURDAT2 databases. The full list of storm types is obtained from ATCF
            database: TD - tropical depression, TS - tropical storm, TY - typhoon, ST -
            super typhoon, TC - tropical cyclone, HU - hurricane, SD - subtropical
            depression, SS - subtropical storm, EX - extratropical systems, MD - monsoon
            depression, IN - inland, DS - dissipating, LO - low, WV - tropical wave, ET -
            extrapolated, XX - unknown. These type are now mapped to the storm types used
            in the Extended Best Track as: “DB” – D, “TD”,”TS”,”TY”,”ST”,”TC”,”HU”, “HR” –
            “*” for all tropical cases; “SD”, ‘’SS’, ”SH” – “S” for all subtropical cases;
            “EX” – “E”, “PT” = P for Potential Tropical Cyclone in the Atlantic; “IN” –
            “I”, “DS”, "LO" – "L"; “WV” – “W”, ”ET” – “A”, “MD” – “M”, “XX”, “” – “X” – for
            all unknown or when the storm type is missing in the input databases.  

        8. The distance to land for all cases has been updated using the 2019 updated
            SHIPS model database for distance to land with 0.1 deg precision; 

        9. Storm names were used when available in HURDAT2, -b-deck, or –a-deck. When
            the storm names are not available, or generic storm names used in HURDAT2 or
            ATCF, including “UNKNOWN”, “SUBTROP”, or number is used as a storm name, the
            storm names for the Extended Best Track have been created using the following
            rules. If the maximum intensity for the storm is less than 35 kt, then the name
            is “TD01” where 01 is replaced by the storm name from ATCF ID. For the storms
            named “SUBTROP”, “SS01” was used where the number is replaced by the ATCF id;
            in all other cases when storm name is missing or generic, the storm name was
            created by using 2-letter basin (AL, EP, CP) and 2-digit ATCF id, for example
            “AL01”.

        10. A new format was added. Changes relative to the old format include: added 2
            spaces to storm name column to allow for longer storm names. The updated column
            with matches the wind of the storm name column used in ATCF; added 1 space to
            longitude and to latitude columns to accommodate 3-digit negative longitudes
            and 2-digit negative latitudes; changed storm ID in the first column to use
            4-digit year; added extra column to describe data source for radius of maximum
            wind speed, eye diameter, pressure of the outer closed isobar, radius of the
            outer closed isobar. The new column is described above in change 6. 

    The 2021 ver 3.0.0 updates that resulted in changes to the radius of maximum
        wind speed, eye diameter, pressure of the outer closed isobar, and radius of
        the outer closed isobar data include: 
    
            1.	These values are not officially best tracked, so in the previous
                versions the b-deck values for those variables have not been used. 
                The 2021 version 3.0.0 includes values from b-deck, when available.

            2. In the previous version the data at the very beginning or very
                end of the storm were sometimes not recorded due to a bug in the processing
                software. That has been fixed in version 3.0.0. 

IMPORTANT NOTE: 
---------------
If you need to refer to the Extended Best Track file in a publication, a
very brief description can be found in the following paper:

    Demuth, J., M. DeMaria, and J.A. Knaff, 2006: Improvement of advanced microwave
    sounder unit tropical cyclone intensity and size estimation algorithms. J.
    Appl. Meteor., 45, 1573-1581.


