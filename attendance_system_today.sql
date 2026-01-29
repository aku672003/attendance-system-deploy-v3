--
-- PostgreSQL database dump
--

\restrict mOghvKTWMfRnIBedrgrCZ0djRzFMm1dSKXl7C7yVbB31hXgeiRzgKK0Z7P4wmZ2

-- Dumped from database version 17.7 (Ubuntu 17.7-3.pgdg22.04+1)
-- Dumped by pg_dump version 17.7 (Ubuntu 17.7-3.pgdg22.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: employee_doc_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.employee_doc_type AS ENUM (
    'aadhar',
    'pan',
    'other_id',
    'highest_qualification',
    'professional_certificate',
    'other_qualification'
);


ALTER TYPE public.employee_doc_type OWNER TO postgres;

--
-- Name: check_out(integer, date, time without time zone, jsonb, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.check_out(emp_id integer, att_date date, check_out time without time zone, location_data jsonb, photo_data text) RETURNS TABLE(message text, work_hours numeric, is_half_day boolean, status_type text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    total_hrs DECIMAL(4,2) := 0.00;
    is_half BOOLEAN := FALSE;
    new_status VARCHAR(20);
    check_in_time_val TIME;
BEGIN
    -- Get check_in_time for calculation
    SELECT check_in_time INTO check_in_time_val
    FROM attendance_records 
    WHERE employee_id = emp_id 
    AND date = att_date;

    IF check_in_time_val IS NOT NULL THEN
        -- Calculate hours worked
        total_hrs := EXTRACT(EPOCH FROM (check_out - check_in_time_val)) / 3600.0;
        total_hrs := ROUND(total_hrs, 2);
    ELSE
        total_hrs := 0.00;
    END IF;

    -- 1) BEFORE 4.5 HOURS → reject
    IF total_hrs < 4.5 THEN
        RETURN QUERY 
        SELECT 
            'You cannot check out before completing 4.5 hours of work.'::TEXT,
            total_hrs,
            FALSE,
            'error'::TEXT;
    ELSE
        -- 2 & 3) 4.5–8 hrs (half day) or 8+ hrs (full day)
        IF total_hrs < 8.0 THEN
            -- Half day
            is_half := TRUE;
            new_status := 'half_day';
        ELSE
            -- Full day - keep original status
            is_half := FALSE;
            SELECT status INTO new_status 
            FROM attendance_records 
            WHERE employee_id = emp_id 
            AND date = att_date;
        END IF;

        -- Update attendance record
        UPDATE attendance_records 
        SET 
            check_out_time = check_out,
            check_out_location = location_data,
            check_out_photo = photo_data,
            total_hours = total_hrs,
            is_half_day = is_half,
            status = new_status,
            updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = emp_id 
        AND date = att_date;

        RETURN QUERY 
        SELECT 
            'Check-out successful'::TEXT,
            total_hrs,
            is_half,
            'success'::TEXT;
    END IF;
END;
$$;


ALTER FUNCTION public.check_out(emp_id integer, att_date date, check_out time without time zone, location_data jsonb, photo_data text) OWNER TO postgres;

--
-- Name: check_wfh_eligibility(integer, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.check_wfh_eligibility(p_emp_id integer, p_check_date date) RETURNS TABLE(employee_id integer, current_count bigint, max_limit integer, can_request boolean)
    LANGUAGE plpgsql
    AS $$
DECLARE
    monthly_limit INT DEFAULT 1;
BEGIN
    RETURN QUERY
    SELECT 
        p_emp_id,
        COUNT(*)::BIGINT as current_count,
        monthly_limit,
        (COUNT(*) < monthly_limit)::BOOLEAN as can_request
    FROM attendance_records 
    WHERE attendance_records.employee_id = p_emp_id  -- Fully qualified column
    AND type = 'wfh'
    AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM p_check_date)
    AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM p_check_date);
END;
$$;


ALTER FUNCTION public.check_wfh_eligibility(p_emp_id integer, p_check_date date) OWNER TO postgres;

--
-- Name: get_accessible_offices(character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_accessible_offices(dept_name character varying) RETURNS TABLE(office_id character varying, office_name character varying, office_address text, office_latitude numeric, office_longitude numeric, office_radius integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT ol.id, ol.name, ol.address, ol.latitude, ol.longitude, ol.radius_meters
    FROM office_locations ol
    INNER JOIN department_office_access doa ON ol.id = doa.office_id
    WHERE doa.department = dept_name AND ol.is_active = TRUE
    ORDER BY ol.name;
END;
$$;


ALTER FUNCTION public.get_accessible_offices(dept_name character varying) OWNER TO postgres;

--
-- Name: mark_attendance(integer, date, time without time zone, character varying, character varying, character varying, jsonb, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.mark_attendance(emp_id integer, att_date date, check_in time without time zone, att_type character varying, att_status character varying, off_id character varying, location_data jsonb, photo_data text) RETURNS TABLE(message text, record_id integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO attendance_records (
        employee_id, date, check_in_time, type, status, 
        office_id, check_in_location, check_in_photo
    ) VALUES (
        emp_id, att_date, check_in, att_type, att_status,
        off_id, location_data, photo_data
    );
    
    RETURN QUERY 
    SELECT 'Attendance marked successfully'::TEXT, currval(pg_get_serial_sequence('attendance_records', 'id'))::INT;
END;
$$;


ALTER FUNCTION public.mark_attendance(emp_id integer, att_date date, check_in time without time zone, att_type character varying, att_status character varying, off_id character varying, location_data jsonb, photo_data text) OWNER TO postgres;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: attendance_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance_records (
    id integer NOT NULL,
    employee_id integer NOT NULL,
    date date NOT NULL,
    check_in_time time without time zone,
    check_out_time time without time zone,
    type character varying(20) NOT NULL,
    status character varying(20) NOT NULL,
    office_id character varying(10),
    check_in_location jsonb,
    check_out_location jsonb,
    check_in_photo text,
    check_out_photo text,
    total_hours numeric(4,2) DEFAULT 0.00,
    is_half_day boolean DEFAULT false,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT attendance_records_status_check CHECK (((status)::text = ANY (ARRAY[('present'::character varying)::text, ('half_day'::character varying)::text, ('wfh'::character varying)::text, ('client'::character varying)::text, ('absent'::character varying)::text]))),
    CONSTRAINT attendance_records_type_check CHECK (((type)::text = ANY (ARRAY[('office'::character varying)::text, ('wfh'::character varying)::text, ('client'::character varying)::text])))
);


ALTER TABLE public.attendance_records OWNER TO postgres;

--
-- Name: attendance_records_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.attendance_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.attendance_records_id_seq OWNER TO postgres;

--
-- Name: attendance_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.attendance_records_id_seq OWNED BY public.attendance_records.id;


--
-- Name: department_office_access; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.department_office_access (
    id integer NOT NULL,
    department character varying(20) NOT NULL,
    office_id character varying(10) NOT NULL,
    CONSTRAINT department_office_access_department_check CHECK (((department)::text = ANY (ARRAY[('IT'::character varying)::text, ('HR'::character varying)::text, ('Surveyors'::character varying)::text, ('Accounts'::character varying)::text, ('Growth'::character varying)::text, ('Others'::character varying)::text])))
);


ALTER TABLE public.department_office_access OWNER TO postgres;

--
-- Name: department_office_access_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.department_office_access_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.department_office_access_id_seq OWNER TO postgres;

--
-- Name: department_office_access_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.department_office_access_id_seq OWNED BY public.department_office_access.id;


--
-- Name: employee_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_documents (
    id integer NOT NULL,
    employee_id integer NOT NULL,
    doc_type public.employee_doc_type NOT NULL,
    doc_name character varying(100) NOT NULL,
    doc_number character varying(100),
    file_name character varying(255) NOT NULL,
    file_path character varying(500) NOT NULL,
    uploaded_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.employee_documents OWNER TO postgres;

--
-- Name: employee_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.employee_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.employee_documents_id_seq OWNER TO postgres;

--
-- Name: employee_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.employee_documents_id_seq OWNED BY public.employee_documents.id;


--
-- Name: employee_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_profiles (
    id integer NOT NULL,
    employee_id integer NOT NULL,
    emergency_contact_name character varying(100),
    emergency_contact_phone character varying(20),
    alternate_number character varying(20),
    bank_account_number character varying(50),
    bank_ifsc character varying(20),
    bank_bank_name character varying(100),
    pan_number character varying(20),
    aadhar_number character varying(20),
    qualification character varying(255),
    certificates_summary text,
    home_address text,
    current_address text,
    date_of_joining date,
    skill_set text,
    reporting_manager character varying(100),
    planned_leaves integer DEFAULT 0,
    unplanned_leaves integer DEFAULT 0,
    professional_training text,
    family_details text,
    marital_status character varying(20),
    personal_email character varying(120),
    gender character varying(20),
    date_of_birth date,
    documents_pdf_path character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT employee_profiles_gender_check CHECK (((gender)::text = ANY (ARRAY[('male'::character varying)::text, ('female'::character varying)::text, ('other'::character varying)::text, ('prefer_not_to_say'::character varying)::text]))),
    CONSTRAINT employee_profiles_marital_status_check CHECK (((marital_status)::text = ANY (ARRAY[('single'::character varying)::text, ('married'::character varying)::text, ('divorced'::character varying)::text, ('widowed'::character varying)::text, ('other'::character varying)::text])))
);


ALTER TABLE public.employee_profiles OWNER TO postgres;

--
-- Name: employee_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.employee_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.employee_profiles_id_seq OWNER TO postgres;

--
-- Name: employee_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.employee_profiles_id_seq OWNED BY public.employee_profiles.id;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employees (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    password character varying(255) NOT NULL,
    name character varying(100) NOT NULL,
    email character varying(100) NOT NULL,
    phone character varying(20) NOT NULL,
    department character varying(20) NOT NULL,
    primary_office character varying(10) NOT NULL,
    role character varying(10) DEFAULT 'employee'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT employees_department_check CHECK (((department)::text = ANY (ARRAY[('IT'::character varying)::text, ('HR'::character varying)::text, ('Surveyors'::character varying)::text, ('Accounts'::character varying)::text, ('Growth'::character varying)::text, ('Others'::character varying)::text]))),
    CONSTRAINT employees_role_check CHECK (((role)::text = ANY (ARRAY[('employee'::character varying)::text, ('admin'::character varying)::text])))
);


ALTER TABLE public.employees OWNER TO postgres;

--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.employees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.employees_id_seq OWNER TO postgres;

--
-- Name: employees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.employees_id_seq OWNED BY public.employees.id;


--
-- Name: monthly_attendance_stats; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.monthly_attendance_stats AS
 SELECT employee_id,
    EXTRACT(year FROM date) AS year,
    EXTRACT(month FROM date) AS month,
    count(*) AS total_days,
    COALESCE(sum(total_hours), (0)::numeric) AS total_hours,
    sum(
        CASE
            WHEN (is_half_day = true) THEN 1
            ELSE 0
        END) AS half_days,
    sum(
        CASE
            WHEN ((type)::text = 'wfh'::text) THEN 1
            ELSE 0
        END) AS wfh_days,
    sum(
        CASE
            WHEN ((type)::text = 'office'::text) THEN 1
            ELSE 0
        END) AS office_days,
    sum(
        CASE
            WHEN ((type)::text = 'client'::text) THEN 1
            ELSE 0
        END) AS client_days
   FROM public.attendance_records
  GROUP BY employee_id, (EXTRACT(year FROM date)), (EXTRACT(month FROM date));


ALTER VIEW public.monthly_attendance_stats OWNER TO postgres;

--
-- Name: office_locations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.office_locations (
    id character varying(10) NOT NULL,
    name character varying(100) NOT NULL,
    address text NOT NULL,
    latitude numeric(10,8) NOT NULL,
    longitude numeric(11,8) NOT NULL,
    radius_meters integer DEFAULT 50,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.office_locations OWNER TO postgres;

--
-- Name: wfh_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.wfh_requests (
    id integer NOT NULL,
    employee_id integer NOT NULL,
    requested_date date NOT NULL,
    reason text,
    status character varying(20) DEFAULT 'pending'::character varying,
    reviewed_by integer,
    admin_response text,
    reviewed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT wfh_requests_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text])))
);


ALTER TABLE public.wfh_requests OWNER TO postgres;

--
-- Name: wfh_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.wfh_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.wfh_requests_id_seq OWNER TO postgres;

--
-- Name: wfh_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.wfh_requests_id_seq OWNED BY public.wfh_requests.id;


--
-- Name: attendance_records id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_records ALTER COLUMN id SET DEFAULT nextval('public.attendance_records_id_seq'::regclass);


--
-- Name: department_office_access id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.department_office_access ALTER COLUMN id SET DEFAULT nextval('public.department_office_access_id_seq'::regclass);


--
-- Name: employee_documents id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_documents ALTER COLUMN id SET DEFAULT nextval('public.employee_documents_id_seq'::regclass);


--
-- Name: employee_profiles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_profiles ALTER COLUMN id SET DEFAULT nextval('public.employee_profiles_id_seq'::regclass);


--
-- Name: employees id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employees ALTER COLUMN id SET DEFAULT nextval('public.employees_id_seq'::regclass);


--
-- Name: wfh_requests id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wfh_requests ALTER COLUMN id SET DEFAULT nextval('public.wfh_requests_id_seq'::regclass);


--
-- Data for Name: attendance_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.attendance_records (id, employee_id, date, check_in_time, check_out_time, type, status, office_id, check_in_location, check_out_location, check_in_photo, check_out_photo, total_hours, is_half_day, notes, created_at, updated_at) FROM stdin;


--
-- Data for Name: department_office_access; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.department_office_access (id, department, office_id) FROM stdin;
1	IT	79
2	IT	105
3	HR	79
4	HR	105
5	Surveyors	79
6	Surveyors	105
7	Accounts	79
8	Accounts	105
9	Growth	79
10	Growth	105
11	Others	79
12	Others	105
\.


--
-- Data for Name: employee_documents; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.employee_documents (id, employee_id, doc_type, doc_name, doc_number, file_name, file_path, uploaded_at) FROM stdin;
1	2	aadhar	Aadhaar Card	32442fgdgd	keshav.s_1764308362_keshav.s_aadhar.pdf	uploads/keshav.s_1764308362_keshav.s_aadhar.pdf	2025-11-28 05:39:22.761899
2	2	pan	PAN Card	HAGPK9920L	keshav.s_1764308362_keshav.s_pan.pdf	uploads/keshav.s_1764308362_keshav.s_pan.pdf	2025-11-28 05:39:22.7636
5	2	other_id	tyjuytfu	fgrtyt	keshav.s_1764308362_keshav.s_tyjuytfu.pdf	uploads/keshav.s_1764308362_keshav.s_tyjuytfu.pdf	2025-11-28 05:39:22.764534
6	2	highest_qualification	BCA MCA		keshav.s_1764308472_keshav.s_highestqualification.pdf	uploads/keshav.s_1764308472_keshav.s_highestqualification.pdf	2025-11-28 05:41:12.53785
9	108	aadhar	Aadhaar Card	880887411962	afnanmir08_1766938180_afnanmir08_aadhar.pdf	uploads/afnanmir08_1766938180_afnanmir08_aadhar.pdf	2025-12-28 16:09:40.798276
10	108	pan	PAN Card	IDIPM5484H	afnanmir08_1766938180_afnanmir08_pan.pdf	uploads/afnanmir08_1766938180_afnanmir08_pan.pdf	2025-12-28 16:09:40.806776
\.


--
-- Data for Name: employee_profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.employee_profiles (id, employee_id, emergency_contact_name, emergency_contact_phone, alternate_number, bank_account_number, bank_ifsc, bank_bank_name, pan_number, aadhar_number, qualification, certificates_summary, home_address, current_address, date_of_joining, skill_set, reporting_manager, planned_leaves, unplanned_leaves, professional_training, family_details, marital_status, personal_email, gender, date_of_birth, documents_pdf_path, created_at, updated_at) FROM stdin;
7	21			9779969654	41387325069	SBIN0001828	\N			\N	\N	#808, phase 4, mohali(pb)		2025-10-15	HTML, CSS, Bootstrap, Python, Django		0	0			single		female	2005-09-30	\N	2025-11-30 04:43:12.020608	2025-11-30 04:47:53.429895
8	22	6206945227	6206945227	6206845227			\N			\N	\N	Hazaribagh, Jharkhand, 825311	Banur, Punjab, 140301	\N			0	0			single	anuj.hanuai@gmail.com	male	2003-09-18	\N	2025-11-30 04:52:42.325301	2025-11-30 04:52:42.325301
27	116	Ravinder Singh	7015212245	7015212245	50100782031017	HDFC0001417	\N	ILXPS1264N	‭933619243729‬	\N	\N	1642-F/1, Ishwar nagar, workshop road, yamunanagar, haryana	616 bjbf heights, sante majra, kharar landran road, Mohali	\N			0	0		Ravinder Singh - Brother - 7015212245	single	tarundeep416@gmail.com	male	1999-12-18	\N	2025-12-21 07:33:04.298804	2025-12-21 11:47:53.634291
10	30						\N			\N	\N			\N			0	0			single	akshitarora672003@gmail.com	male	2003-07-06	\N	2025-11-30 10:55:48.926094	2025-11-30 10:55:48.926094
11	5	Nishant kagra	8351907905				\N			\N	\N	Runjha, Mandi Subdistrict	Near christ the king church church road dashmesh nagar nayagaon.	2025-11-24	Python.		0	0			single	nishantkagra420@gmail.com	male	2002-08-22	\N	2025-11-30 11:14:56.993427	2025-11-30 11:14:56.993427
12	35						\N			\N	\N			2025-03-17			0	0			single		male	\N	\N	2025-11-30 12:26:55.536005	2025-11-30 12:26:55.536005
15	33						\N			\N	\N			\N			0	0			single	adityaad79@gmail.com	male	2001-02-10	\N	2025-12-02 05:14:01.893305	2025-12-02 05:14:01.893305
16	28	7973689236	7973689236	7973689236			\N			\N	\N	Dhangadhimai-01siraha nepal	Ramnagar banur	2025-10-01			0	0			single	rameshyadav57812@gmail.com	male	2001-04-20	\N	2025-12-03 07:16:18.490489	2025-12-03 07:22:07.416153
17	11						\N			\N	\N			\N			0	0			single		male	\N	\N	2025-12-09 05:04:31.776428	2025-12-09 05:04:31.776428
18	7						\N			\N	\N			\N			0	0			single		male	\N	\N	2025-12-09 05:05:54.960725	2025-12-09 05:05:54.960725
19	102			8427291205			\N			\N	\N			2025-12-08		Ms Prerna Kalra	0	0			single		male	\N	\N	2025-12-10 11:39:16.238457	2025-12-10 11:39:16.238457
3	14			9988222890	42420100001360		\N	QNZPS5120R	737828956773	\N	\N	Ajit Nagar, Bassi Road, Sirhind, Fatehgarh Sahib	110,TDI City, Mohali	2025-10-15	Python, Django, HTML, CSS, Surveyor		0	0		Bhagwant Singh - Father\nParminder Kaur - Mother	single	yuvrajjabbal@gmail.com	male	2004-01-20	\N	2025-11-28 06:16:52.390875	2025-12-23 02:33:56.345841
2	3	00000000000	33333333333	6562325035	5296491	oan1551	\N	326261430	548131683145	\N	\N	jalandhar	mohali	2025-08-05	python ai	hr	10	2		father \n12451651321	single	zaildarsukh3@gmail.com	male	2003-07-10	\N	2025-11-26 11:54:18.680632	2025-11-27 05:02:47.36192
24	107	SUNNY	7870303674	9279008436	5906304119	CBIN0282467	\N	JCIPK4693C	522814127516	\N	\N	BSNL TOWER, PREMRAJ, POST - R.KORIGAWN, PS- GORAUL, VAISHALI, BIHAR -844114	BSNL TOWER, PREMRAJ, POST - R.KORIGAWN, PS- GORAUL, VAISHALI, BIHAR -844114	2025-12-06	ADCA, AUTOCAD, HDD MACHINE OPARATION	MANI KUMAR	0	0		MANI KUMAR - BROTHER	single	sunnykumar7544886994@gmail.com	male	2000-08-08	\N	2025-12-18 14:22:11.538533	2025-12-19 15:57:23.412858
25	106	FATHER	+917743018929	8360375531	44490666959	SBIN00511214	\N		650779952249	\N	\N	DISTT.HOSHIARPUR \nTEHSIL-MUKERIAN \nVPO-DEPUR	DISTT.HOSHIARPUR \nTEHSIL-MUKERIAN \nVPO-DEPUR	2025-12-08	Basic knowledge of computer or laptop		0	0			single	shibuchoudhary83@gmail.com	male	2007-03-19	\N	2025-12-20 04:08:59.683749	2025-12-20 04:09:44.789602
26	110	Avinash	7667842845	7667842845	410502010706072	UBIN0541052	\N	QRMPS9630B	716697866283	\N	\N	Bahimar hazaribagh jharkhand	Banur punjab	2025-12-09		Rajnish sir/ kaushal Saini sir / Bharti ma'am	0	0			single	avinash766784@gmail.com	male	2004-01-19	\N	2025-12-20 06:04:54.860404	2025-12-20 06:32:35.871352
1	2	Sunny Bishnoi	9518254390	8708592384	0970000102089161	PUNB0097000	\N	HAGPK9920L	259651427524	\N	\N	Abubshahar, Mandi Dabwali, Sirsa, Haryana	Mohali, Punjab, India	2025-10-15	Front-end Developer	Mohneesh Sir	10	0		Vijay Pal - Father - 9416192384	single	Kmsuthar2903@gmail.com	male	1999-03-29	\N	2025-11-26 11:44:10.052099	2025-12-24 12:28:30.670492
28	108	Afnan Mir	06206271022	9955140653	55520100011725	BARB0BEROXX	\N	IDIPM5484H	880887411962	\N	\N	Mahru , Bero, Ranchi Jharkhand	Mahru , Bero, Ranchi Jharkhand	2025-09-12	Java , SQL , MongoDB, React , Express, Node.js , Flutter , Firebase , HTML , CSS, JS, C, C++, Digital Marketing, Ui / Ux	Rajnish Sir	0	0		Jaferul Mir - Father - 8757081888\nSanjeeda Khatoon - Mother - 9955140653	single	afnanmir9060@gmail.com	male	2005-08-03	\N	2025-12-28 16:09:44.695043	2025-12-28 16:09:44.695043
29	96	Harleen kaur	98774 71722	9878481045			\N			\N	\N	#39, Shresth Housing Complex 1, Balaji Enclave Phase 2 ,Lohgarh, Zirakpur,Punjab	#39, Shresth Housing Complex 1, Balaji Enclave Phase 2 ,Lohgarh, Zirakpur,Punjab	2025-01-04			0	0			single	sweety43968@gmail.com	female	2002-08-23	\N	2026-01-02 07:17:57.112196	2026-01-02 07:18:01.336996
\.


--
-- Data for Name: employees; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.employees (id, username, password, name, email, phone, department, primary_office, role, is_active, created_at, updated_at) FROM stdin;
25	Prerna	$2y$10$H4.qKETDmfmpdgsWYw3Hb.6S3.snR5ORclf/4nVMXA5nyLqx5IYM6	Prerna kalra	prerna@roadathena.com	9988997555	Others	105	employee	t	2025-11-30 06:02:11.275308	2025-11-30 06:02:11.275308
26	Princeraj	$2y$10$Q/QomN1Ylz7xPvkpRagVR.xTtmJKCFqaBlRFk0CSStPYMFYlZn7VO	Prince Kumar Chakram 	prince.hanuai@gmail.com	6201550850	Others	105	employee	t	2025-11-30 06:33:56.012682	2025-11-30 06:33:56.012682
3	sukh	$2y$10$Z6QlS9d319BggwIJlVTkE.O/ADd5s/Vr2YHLIi1.WEZhpFZBgaLeC	sukhwinder	sukh.hanu@gmail.com	9592325035	IT	105	employee	t	2025-11-26 11:51:25.962554	2025-11-27 04:57:46.251988
1	admin	$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi	HR	admin@company.com	9999999999	IT	105	admin	t	2025-11-26 10:33:10.644579	2025-11-27 04:58:05.22101
4	AdiTya	$2y$10$3YNS7Q8w5EqMXLaEpuEIS.rD6ErgqVtWeKhJPGkAhvftiy8d2hpSC	Aditya Arora	arora150266@gmail.com	9876967244	IT	105	employee	t	2025-11-27 05:33:03.924693	2025-11-27 05:33:03.924693
8	keshav28_13	$2y$10$Pyn1GB577oqsOt3N7EEzLuQeO/vagP0.r9HlwN91eWtlRxIPuPv6q	Keshav Hari Nanda	keshav.kh67@gmail.com	9464548477	IT	105	employee	t	2025-11-27 06:36:06.954281	2025-11-27 06:36:06.954281
9	prabin	$2y$10$fvJc98rGIrj0ntUCoTNuteMVFMWR7wLR/IzHTw9DvGf3OL5vuXtDS	Prabin Kumar Mohanta	prabin@hanu.ai	7327824389	IT	105	employee	t	2025-11-27 07:19:53.824786	2025-11-27 07:19:53.824786
10	rajnish281	$2y$10$mv8mF2PfNRmQ/yGoOBk5/eQzzKIfqmvf3E7Ni9Dk8GrJtvQBoMeba	Rajnish Thakur	rajnish.hanuai@gmail.com	7009953149	Surveyors	105	employee	t	2025-11-27 07:32:54.799155	2025-11-27 07:32:54.799155
29	Nirajan 	$2y$10$sMqAKpoJ/DFwXfTHjG2zl.Qb2hFAeQhRxqK4u8RLhhvSNwnWZM6Cy	Nirajan kumar yadav	nirajanyadav791@gmail.com	9877938433	Surveyors	105	employee	t	2025-11-30 08:14:05.556297	2025-11-30 08:14:05.556297
35	Jaikaran	$2y$10$ivwIOwUS4peAhNXeCP9g1ujAxf9Fdha3A/gXINsyN9YNgzeP.uYMu	Jaikaran	jaikaran@hanu.ai	7986388207	IT	105	employee	t	2025-11-30 12:25:23.251766	2025-11-30 12:26:55.467548
12	amar@bar	$2y$10$5prRzczmxYqtFx5VtNHqsOs7Qu..RHuXR07Pk.BHRuJrq8avyjpJm	Amar Bar	amarb2019@gmail.com	8339816689	IT	105	employee	t	2025-11-28 05:17:06.241746	2025-11-28 05:17:06.241746
13	Anil Goswami 	$2y$10$JAUUf7bZFdMW03wucFVjkecP71siDynSvgHzGuWca1KbaKZBMCIdS	Anil Goswami	anil.hanuai@gmail.com	8770295541	IT	105	employee	t	2025-11-28 05:51:06.62737	2025-11-28 05:51:06.62737
7	Avnish Ranjan	$2y$10$0EixhIqTiXAQXcquzH1N/uAEVsazu6VXAxj9FhWY.cvvZbNpJ5Blu	AVNISH RANJAN	Avnish@hanu.ai	9660346509	IT	105	employee	t	2025-11-27 06:30:49.491838	2025-12-19 11:13:07.265038
24	Bharti	$2y$10$XigDqh/mO4XUPWPO23ErLeOQ0FDBzLxgNMZsson.SWw7Y8H/OaI76	Bharti Kumari			IT	105	employee	t	2025-11-30 05:07:22.501912	2025-12-11 11:55:09.46804
76	vikesh9525	$2y$10$Kir73.UcYgTxvOUCDMagUu8miPPdqKgMRD9b7PBHwm74soTE4j5SS	vikesh mishra	vikesh.hanuai@gmail.com	9525386495	IT	105	employee	t	2025-12-01 05:58:34.991412	2025-12-01 05:58:34.991412
16	MANI632	$2y$10$2zHUl7Y/EjIHwlY88n7Zi.w4W3TlaLXb0fxc/iGH0ljU254dqvIiu	MANI KUMAR	mani.hanuai@gmail.com	6284693406	Surveyors	105	employee	t	2025-11-28 13:23:56.757807	2025-11-28 13:23:56.757807
17	Anubhav	$2y$10$h.GkuyHfhrwC/TVDY8KA9Odn23VmRBCGvmxBsTzp508dDXCPIS7SS	Anubhav kumar 	bhagatanubhavkumar5@gmail.com	9876297095	Surveyors	105	employee	t	2025-11-29 09:33:01.362844	2025-11-29 09:33:01.362844
18	Krishan	$2y$10$avilYEfxMoKXe3CHY8YmNOZ9iyOpATTZh/hV/KWjXqA14VQ3kSCti	Krishnan raut	krishna.hanuai@gmail.com	7986821154	Surveyors	105	employee	t	2025-11-29 09:39:17.170858	2025-11-29 09:39:17.170858
20	Bhanu	$2y$10$.PMz/U.SQopg9LuMIJ8t7eBnqLwW1T8J2CjKb2BLVnm6upZxFaDKS	Bhanu pratap 	bhanu.hanuai@gmail.com	7876173660	IT	105	employee	t	2025-11-29 11:57:56.052437	2025-11-29 11:57:56.052437
28	Ramesh yadav	$2y$10$JDviWesKhHQG1RM.jvuKyOkA/TmZcaU/ppsXkDH6U/V7ahO9zJG1W	Ramesh Kumar yadav	rameshyadav57812@gmail.com	7973689236	Surveyors	105	employee	t	2025-11-30 08:12:15.951494	2025-12-03 07:22:07.342009
22	Anuj_kumar	$2y$10$8QuqB03ij/L84b28vboG.ujgEkuOhzVKwKc2ZerWXH6S7Eh6ItXgO	Anuj Kumar	anuj.hanuai@gmail.com	6206945227	IT	105	employee	t	2025-11-30 04:47:06.272527	2025-11-30 04:52:42.256204
23	kaushik07	$2y$10$GHQSyC7HYQbt/DCOJXEj9.XjuSI6tVEOceZ7Jj8EpigMK2JLi9dFC	Kaushik Kumar Giri	kaushik@hanu.ai	9090395706	IT	105	employee	t	2025-11-30 05:04:44.184498	2025-11-30 05:04:44.184498
30	akshit	$2y$10$iczNGUoJ.bhlOUcfIcPizedo18pq1KtzXyzxIzotyny/YdXTz9PMO	AKSHIT	akshitarora672003@gmail.com	7497884964	IT	105	employee	t	2025-11-30 10:53:21.00088	2025-11-30 10:55:48.893477
5	Nishant kagra	$2y$10$AYCzq7qmtRk6X749l/VZ2uP7TXhDWyvJG0pAHqlVaY/jDhwwLzvKW	Nishant	nishantkagra420@gmail.com	8351907905	IT	105	employee	t	2025-11-27 05:34:48.185118	2025-11-30 11:14:56.911576
70	mukeshhanuai@gmail.com	$2y$10$8KKv92m7m7S6boS5OZwd1u/ANiWFxF2LzvO4JApJts2tILIeiFY0i	Mukesh Kumar	yadavmukesh5710@gmail.com	9905548807	IT	105	employee	t	2025-12-01 04:35:30.47214	2025-12-01 04:35:30.47214
74	Nikhil 	$2y$10$JPcmOXar7ifIjGdOmJ7HuO82bJtPgKaa0tYOQEuu9vBMnJOl1A.m6	Nikhil 	nikhilbhardwaj0013@gmail.com	8307459326	IT	105	employee	t	2025-12-01 05:25:58.773587	2025-12-01 05:25:58.773587
75	Anshika Rajput 	$2y$10$oK/lUWcCRXo0/1o6VUwydeLhAOhpZK8H6OlI.RzHrYMQc8Xwl2uIi	Anshika Rajput	anshikarajput682003@gmail.com	8082952710	Growth	105	employee	t	2025-12-01 05:31:53.909065	2025-12-01 05:31:53.909065
21	Harsimran	$2y$10$fWotYIY/cGV7c/IxxDQ.DOQ/XHmkYWe7Nyxlyyfv7UmCE.DhMmpPi	Harsimran Kaur	harsimrank00005@gmail.com	7973793683	IT	105	employee	t	2025-11-30 04:41:38.492082	2025-12-03 04:48:34.917759
6	nitin.hanuai	$2y$10$aOmvyMEW4HyfkMArUg724OgzS0LE9iLC6QLufVNob.jRhxxAb8cd2	Nitin	nitin.hanuai@gmail.com	9646075996	IT	105	employee	t	2025-11-27 06:30:10.637591	2025-12-03 05:17:48.03436
11	Ankit@hanu.ai1	$2y$10$Mocac8nBw4ezLJmGKzdcOOffkuJCDwB9wAUYARNS3aYvbg.WD85za	Ankit Verma	Ankit@hanu.ai	8168143325	IT	105	employee	t	2025-11-28 05:12:52.594891	2025-12-11 03:39:23.231585
71	Kajal	$2y$10$2alvzYan.2huHPMJ2ul98uO83OpEt8YcFHkVxLNzfoTJ8k63pMYRe	Kajal	Sabharwal2041999@gmail.com	8968198947	HR	105	employee	t	2025-12-01 05:01:52.754841	2025-12-13 10:09:12.483837
77	Tarun	$2y$10$buTcyZ47HRkMT9RELzDgieQ1Pl.eiR/bW10Egq3WT.P4ZvBebTuGe	Tarun Behal	tkb123345@gmail.com	8528044415	IT	105	employee	t	2025-12-01 06:04:33.229391	2025-12-01 06:04:33.229391
78	harveen kaur	$2y$10$0QbUxLYvs3MfGbkAwghSKOD6cmCwcqI3QQtfKupumblC8MyiFq0D6	Harveen kaur	harveen.hanuai@gmail.com	9779512804	Others	105	employee	t	2025-12-01 12:45:54.182632	2025-12-01 12:45:54.182632
79	Sanjeebydv	$2y$10$fu7gH/QSBOMkS0uNcJ48HunPPScqF2s3aI1uG9d9iHq2toVdES6W.	Sanjeeb kumar yadav 	mangardaitasanjeeb45@gmail.com	6284744953	Surveyors	105	employee	t	2025-12-01 17:11:09.013635	2025-12-01 17:11:09.013635
34	Dheeraj sharma	$2y$10$XAJ68lAL9Psnc.utfeIwp.XDSDMxGbpLBZ9nJK1IhEZXc6pVhIj6u	Dheeraj Sharma	dheerajhhanuai@gmail.com	7876065410	IT	105	employee	t	2025-11-30 12:12:38.196422	2026-01-02 14:26:53.525394
73	Imrkraghu	$2y$10$K2zGpdgQq8/6McEWF03YX.aDIjga7K1M687BRWuNLtGD4jN7iEuUu	Rohit kumar	rohit.hanuai@gmail.com	8427626787	IT	105	employee	t	2025-12-01 05:24:34.597188	2026-01-03 05:19:30.979738
31	Divya	$2y$10$yizJmu7C1nYpgL5NU.Fsd.e5Ik7QU8/2XWXHu52p16m1nTHWe2JQ2	Divya	divyanamdev90@gmail.com	7983445742	IT	105	employee	t	2025-11-30 11:11:54.63947	2026-01-03 12:41:28.426387
37	Mehakpreet 	$2y$10$kkxtXZHNslKKZADUc6tKxeqnOfFAsT.G7DvlZ3T/if.3/wycepfj.	Mehakpreet kaur	mehak.saini1011@gmail.com	7719747276	IT	105	employee	t	2025-12-01 02:53:11.25146	2026-01-05 11:21:44.513341
33	aditya	$2y$10$vf/8iHVCW15.AXFflPiwcOCNfrGOha3dn1XqDHiAalyoxtnN3QKXW	Aditya	adityaad79@gmail.com	7814784307	IT	105	employee	t	2025-11-30 11:41:42.443979	2025-12-02 05:14:01.860385
80	aniket.hanuai	$2y$10$3Tcf/om3P.P5.uO4y22BGOnCh4eWQSLN4s7lBv/W.cXpIgO4byS9C	Aniket Kalta	kaltaaniket@gmail.com	7876213404	IT	105	employee	t	2025-12-02 05:27:54.059534	2025-12-02 05:27:54.059534
27	Rasmi	$2y$10$vijT5Ci7vbYNXv8p4T.22.2Lw89ETVyNve8VNQlddaWDTbMRVRg/K	Rasmita Behera	brasmita998@gmail.com	8917690796	IT	105	employee	t	2025-11-30 06:43:21.108709	2026-01-09 04:52:03.373755
14	Yuvraj	$2y$10$PA6oMjclUqicpH0XIExQ8O4WJsjREyOGdPwyFQrr5VuIVYenysVpq	Yuvraj Singh	yuvrajjabbal@gmail.com	8872399570	IT	105	employee	t	2025-11-28 06:11:19.659098	2026-01-10 05:50:57.490216
83	kaushal@4988	$2y$10$.SX.xw8KRJ4hxTdTPM9.beAuDm6YfONeJM7NSviSYO18TePkKWANG	Kaushal Saini	kaushalsaini121995@gmail.com	9996454773	IT	105	employee	t	2025-12-03 04:28:47.835781	2025-12-03 04:28:47.835781
84	Anish Rana	$2y$10$dsCBNkvToZQlIeiPifuJZud.H5E0Oc8ggOF56vzk5qorcEUb2Xa4i	Anish Rana 	anishrana7717@gmail.com	7717331091	IT	105	employee	t	2025-12-03 04:30:42.380356	2025-12-03 04:30:42.380356
85	Mithuraj	$2y$10$IfT9xV682nvGr3LNxozbuuSo6K5jKmfordVFpC589iFuDUueiq.yW	Prince Kumar Chakram 	princechakram619@gmail.com	6201550850	Others	105	employee	t	2025-12-03 04:31:52.956796	2025-12-03 04:31:52.956796
87	Suraj	$2y$10$BGTSnBinCdsFKNgsGgAf5ukHJmFfXhc3V41uoS53awnQuHbA2mr3K	Suraj Pandey	surajpandey8888z@gmail.com	8872241528	IT	105	employee	t	2025-12-03 04:45:56.154906	2025-12-03 04:45:56.154906
88	Pallavi	$2y$10$Xdx7c1ln9fTTZoPbSJViSuCQJ66.DwhEt4/beh4P1U/ewWwEO82he	Pallavi	pallavi.21ys@gmail.com	7814008666	IT	105	employee	t	2025-12-03 04:58:50.505957	2025-12-03 04:58:50.505957
89	Parul	$2y$10$PWtaUlVUfMP0iVi8ADbK/O91KSfopCIJFI21gvIs.5207YU0A8u9e	Parul Singh	parul1812002@gmail.com	6269567022	Accounts	79	employee	t	2025-12-03 05:06:38.401893	2025-12-03 05:06:38.401893
90	mandharsh38	$2y$10$lIrR/TUivLG0VC8qXP2x8eM1TfRyTR1yzw9HY2dLXhgryaXDCpPZq	Harshdeep Singh Mand	mandharsh38@icloud.com	9877236899	IT	105	employee	t	2025-12-03 05:36:44.922445	2025-12-03 05:36:44.922445
92	SAUMYA SINGH 	$2y$10$2NbhesRZQA7XmMqtbQx9M.4sMBeU72WMR0T/r3L.30cpTzSulrkW2	Saumya Singh	chandelsaumyasingh@gmail.com	8756788999	Growth	105	employee	t	2025-12-03 06:54:49.133987	2025-12-03 06:54:49.133987
93	dipeshydv	$2y$10$5PfqVxDFo6I4wfl3nzNd7OG7vPFBb0ia2U8Lz0xu8BfatlTcLMugK	Dipesh yadav	dipesh35615@gmail.com	7717549567	Surveyors	105	employee	t	2025-12-03 07:26:35.630914	2025-12-03 07:26:35.630914
94	ritesh_sharma	$2y$10$tUwAvJa.Bu8vppQm.lcZYelLz.Qfz38kK9uTpJGd3XsC5Qlu6bdYi	Ritesh Sharma 	Riteshkumar22058@gmail.com	9155898054	IT	105	employee	t	2025-12-03 07:27:11.171302	2025-12-03 07:27:11.171302
97	Aditya yadav 	$2y$10$/vHrN40u6dkIIV5dJA2NXOfKSPVdS8IeT17zT/5nq975quH6hQ.za	Aditya yadav 	aditya.hanuai01@gmail.com	9129598200	Accounts	79	employee	t	2025-12-03 13:01:47.37962	2025-12-03 13:01:47.37962
98	SanatGoel	$2y$10$tusyRWMGa82d7VwcbirELuDpQfdXBiso59YnxkghfNc9bfjcOFWou	Sanat Goel	sanat@hanu.ai	8146202026	Growth	79	employee	t	2025-12-03 15:30:31.073097	2025-12-03 15:30:31.073097
100	Gurmit Singh Baidwan	$2y$10$piE0yl7coMKpiACvolDMCOgAnFdzrYh2Qv6V1sub028.z6Dc9z1y6	Gurmit Singh Baidwan	gurmitsinghhanuai@gmail.com	7889135194	Surveyors	105	employee	t	2025-12-04 04:10:38.575599	2025-12-04 04:10:38.575599
113	Abhi	$2y$10$tqDeA1bC2MLuf6MyS5YY1.ZqkWDe7spoeKVVXGJsnLY17X7FOxxVy	ABHISHEK BHARDWAJ	abhisharma.hanuai@gmail.com	7590954983	IT	105	employee	t	2025-12-18 06:39:50.46918	2025-12-18 06:39:50.46918
114	Qwerty	$2y$10$PR/FVRiQ0oiOQOjxZowhru7eAxXjX.ybyCvlAJmeTa4JUf3cJHaae	Mohneesh R	Mohneesh@hanu.ai	8558841158	IT	105	employee	t	2025-12-18 10:25:59.273177	2025-12-18 10:25:59.273177
101	Indu	$2y$10$LAgAe5brxtNNSFJUiR0ve.pB9MHLOoF/FP0ruva/S3/g36PL9XmdO	Indu	snehamaurya2522009@gmail.com	8084060242	Others	105	employee	t	2025-12-04 04:25:15.356695	2025-12-04 04:25:15.356695
82	Vandana	$2y$10$NL6ZedwU.2bjLraXAcbD2ePvPHXWiGnchdqVZ3bcbH6I7o.Hhhyda	Vandana	vandanahanu125@gmail.com	7988513867	IT	105	employee	t	2025-12-03 04:21:54.663167	2025-12-05 05:11:49.998585
103	Mritunjay 	$2y$10$zjiKlEf8lPds7OiQd/iCmOp9kzskM/20VBZdAnmp0gun6e.SKd.x6	Mritunjay 	gopemritunjay55@gmail.com	7488155067	IT	105	employee	t	2025-12-11 04:24:35.199881	2025-12-11 04:24:35.199881
104	Anurag 	$2y$10$JT0OHOsDNoK0qLUbmtIkPuATfJwOVLZux4pi3ODRgwHYu4R53M/jG	Anurag kumar	anurag2004bgs@gmail.com	9162093933	IT	105	employee	t	2025-12-13 06:22:26.515064	2025-12-13 06:22:26.515064
105	Rahulsingh	$2y$10$fXLpfMIidHw6.63N3FLiZeFsSAc99jcH05R4XEFjCwhb7MYiAV966	Rahul Kumar 	saab49649@gmail.com	7814290743	Surveyors	105	employee	t	2025-12-13 10:06:15.324405	2025-12-13 10:06:15.324405
109	shailen11	$2y$10$7OpStTfHmRnOLcrRZYi.S.vQJO94wpaKBSjK8wlKnVjtHef/QeCuS	Shailendra Yadav	shailendrayadav5265@gmail.com	9125768708	Surveyors	105	employee	t	2025-12-13 15:25:05.773921	2025-12-13 15:25:05.773921
95	Ankur 	$2y$10$mUBl288c7R1/GoMgE4X3/uk.vynvYhnkUyQ7B008BT40pKfxbeQeG	Ankur	palsaab1966@gmail.com	6239294825	IT	105	employee	t	2025-12-03 12:27:34.965726	2025-12-15 05:05:17.075747
111	ritikKash	$2y$10$IWKFGboj8KlorcyIUwENvepY5mpKp8yW6vAVNTiprMpoSzQRta5qG	Ritik	ritikkash41@gmail.com	6239416369	IT	105	employee	t	2025-12-16 04:35:42.791885	2025-12-16 04:35:42.791885
118	Abhishekyadav	$2y$10$7BkTzGsgHNyGGt9hb/pwzO1d5wfpNQ/6b4/y./cReyJcZnBsk5d3e	Abhishek Yadav 	www.chikhu123@gmail.com	8726814063	Surveyors	105	employee	t	2025-12-20 04:24:22.79848	2025-12-20 04:24:22.79848
117	Gajinder 	$2y$10$h/ZohhUa5JvkYMuuagRy7eTUsJdnp.SwHVyb4PGCepuLHKJLXI4Su	Gajinder Sharma 	gajinder.gs.gs@gmail.com	9056664138	Surveyors	105	employee	t	2025-12-19 06:45:15.727902	2025-12-19 06:45:15.727902
107	Sunny099	$2y$10$HoCz1lDcioG0E8mEMNSUTOtO/So034TWWggMUGIWVjpqdcPtOPLcS	SUNNY KUMAR	sunnykumar7544886994@gmail.com	9279008436	Surveyors	105	employee	t	2025-12-13 11:52:36.612181	2025-12-19 15:57:23.218223
116	Tarundeep	$2y$10$jAJT.2eruBSniytSzHPxq.WRVvvBBDFiobvn1m0CSJ4TduIbySI1W	Tarundeep Singh	tarundeep416@gmail.com	8053518483	Surveyors	105	employee	t	2025-12-19 03:08:59.1598	2025-12-21 11:47:53.573166
110	AvinashSingh7667	$2y$10$X9n4thN73FFyejorOhyy9.L/Et.cOaltdbL1JaNhHFuvnw9XpzvFK	Avinash Kumar Singh	avinash766784@gmail.com	7667872845	Surveyors	105	employee	t	2025-12-13 15:27:32.749568	2025-12-20 06:32:35.776732
2	Keshav.S	$2y$10$fenn0laHhlGLG69Na6LhPu/X56aRjIMM4pJ.W0j7Xwik7ZL7D9ZeS	Keshav	kmsuthar2903@gmail.com	9588352678	IT	105	employee	t	2025-11-26 11:14:16.207852	2025-12-24 12:28:30.514269
121	Hanuaiankit1950	$2y$10$LxtVPoYElsasShIXc2e4GuZwXozzVKoh6953kwCWbQURY3NI78OIu	Ankit kumar	hanuaiankit1950@gmail.com	9661293226	Surveyors	105	employee	t	2025-12-28 04:02:40.307445	2025-12-28 04:02:40.307445
96	Sweety	$2y$10$JMuvNSMLKOYxX2609/yU.OKGxxePIiiBLp33eYVEyAvr8kfy7PUSW	Sweety	sweetyhanuai@gmail.com	9877143968	IT	105	employee	t	2025-12-03 12:36:52.725716	2026-01-02 07:18:01.246851
108	afnanmir08	$2y$10$Tx71lFhkBpuLTTOc/X8/eewMVq/.b2Nv7y2oUQFfgcFAIyeYN6cqK	Afnan Mir	afnanmir9060@gmail.com	6206271022	Surveyors	105	employee	t	2025-12-13 12:34:06.130946	2025-12-28 16:09:44.562448
122	Nagendra	$2y$10$9vvp3n3kCgXvyBgbFZaO4uWGL.WFoWem86mHKJaD/yJwbttwTjwIe	Nagendra Madanapalle	nagendra@hanu.ai	6300036819	IT	105	employee	t	2026-01-01 15:53:53.313292	2026-01-01 15:53:53.313292
123	Aanchal	$2y$10$USORwOW0CQmVl7Jgs76S.OiPfZYCtE85C42ah9wQEY6rq0SB/Zy8O	Aanchal	aanchalraj2323@gmail.com	9872777960	IT	105	employee	t	2026-01-01 16:19:11.938979	2026-01-01 16:19:11.938979
124	Chilla123	$2y$10$DheiWfqgL.0NNTWerdaGVOdL6AWtjMcvedfmykvM6zdW.5/.JUiX2	Chilla Suresh	chillasureshreddy94@gmail.com	7974715033	Others	105	employee	t	2026-01-02 04:39:19.687213	2026-01-02 04:39:19.687213
125	P15kumar	$2y$10$hgTLIFIR7ZnUpDmhYCbmpOTUKUkYfz5zPubfUlIbLHAuskvpoiJt2	Prasanta Kumar Sethi	sethip52@gmail.com	7978692005	IT	105	employee	t	2026-01-02 04:59:47.850914	2026-01-02 04:59:47.850914
126	Sushant	$2y$10$GE7JzraYJdRdGnOYu1QI5usT7m52ZZkFcRcGplfr2qBBd.sEEi3zC	Sushant	sushantdwivedi997@gmail.com	9301802256	IT	105	employee	t	2026-01-02 05:03:30.053806	2026-01-02 05:03:30.053806
127	PUNIT	$2y$10$LUjrIa2qOMUJDNPRskzqteQsdlcohF8al7vpPa/sxQ7rjWjQCItIK	PUNIT KUMAR	8628826534pk@gmail.com	8278887102	IT	105	employee	t	2026-01-02 10:36:37.661035	2026-01-02 10:36:37.661035
128	Nikhil sharma	$2y$10$A7XnRieBWKhV5ysBtzEw.OJwQHT3gsVn4pPtuY13IINUF29XOIkUi	Nikhil Kumar	nnikhill2004@gmail.com	7992271483	IT	105	employee	t	2026-01-02 10:41:25.264546	2026-01-02 10:41:25.264546
129	bantykumar_012	$2y$10$.8lAyLmqAf/VHeF5Y5e2X.kEh52wBVmwIyJKVFopHGJxpV7nDbn7y	Banty Modi kumar	rajharshahzb05@gmail.com	9546256884	IT	105	employee	t	2026-01-02 10:45:14.727212	2026-01-02 10:45:14.727212
102	Prayagnr	$2y$10$ogQ2h7vBhMZC0vpk/cvQzewI3V0qBPVjh/GrO/YwdbbRBYEIGmRTu	Prayag Nair	prayaghanuai@gmail.com	7973349367	Others	79	employee	t	2025-12-10 11:36:56.148486	2026-01-14 05:23:00.115148
130	Ritesh Sharma	$2y$10$Ja3/nwfqUlqVuf1LrCqgUu7wgApsvGo44NhABXv4K4x9MjyIDxuiS	Ritesh Sharma	riteshkumar22058@gmail.com	9155898054	IT	105	employee	t	2026-01-02 12:40:53.524588	2026-01-02 12:40:53.524588
132	Tarun behal	$2y$10$rn3qrGEp0O8WEcIkbOJ7O.b76aLdfGaqMrVLA7amWFYNyxlw/XB/q	Tarun behal	tkb24969@gmail.com	8528044415	IT	105	employee	t	2026-01-05 04:46:28.693589	2026-01-05 04:46:28.693589
134	Dibya Prakash Das	$2y$10$zgG/DcEyevnhaeWub6f8U.pOmpG0m8VzIDFlTjlAWWEDzKw7rESy6	Dibya Prakash Das	dibyaprakashdas93@gmail.com	8249587582	IT	105	employee	t	2026-01-05 05:10:53.01004	2026-01-05 05:10:53.01004
135	Arnab Chakraborty 	$2y$10$cHQHU9FO3Ov6JhBvd0bEpOGtSpmh5lOUuwOYeCb6qeijgn4v21lwO	Arnab Chakraborty 	arnabchakraborty901@gmail.com	9658309169	Growth	105	employee	t	2026-01-05 05:12:24.730436	2026-01-05 05:12:24.730436
133	Bhubandeep Singh 	$2y$10$8Q/Q7OYZfAgR.tQkDJvJeeW6ATvKDnjkoQPXfqwgGE3Mc44nWR5Nm	Bhubandeep Singh	bhuvnndeepsingh@gmail.com	9015362082	IT	105	employee	t	2026-01-05 05:09:25.174833	2026-01-07 12:34:31.685745
131	Simran	$2y$10$IuEo4k4t/GP7MgnmdI0Dou5WZsHfKj5QvnCM71HRVdTAzv9Gzb6Sm	Simran	simran0079.hanuai@gmail.com	7082471643	Growth	105	employee	t	2026-01-03 05:18:41.385414	2026-01-14 12:46:31.360716
36	Isha@21	$2y$10$E67hnYE0WzGI0GAe4nTMG.gvsClOW8d39VVFU9kNT6YgVFCYkVwU6	Isha	ishahanuai@gmail.com	7876631123	IT	105	employee	t	2025-11-30 14:24:09.076329	2026-01-07 04:47:13.03973
136	Annu@hanu.ai	$2y$10$78YA4MuUqVhDi4ntfeq5aOQRj3P1.AWd1QDw5dgFSJkichGRl7mc6	Annu Kumari	annuk9836@gmail.com	9142902107	IT	105	employee	t	2026-01-07 05:40:37.206099	2026-01-07 05:40:37.206099
137	Bhupeshydv	$2y$10$JvSSinRYTePVx5FfWCCUGOUV4j71PauARzsMdYnGMClkGM0.M3/DG	Bhupesh Kumar yadav	yadavastosh14@gmail.com	6284687386	Surveyors	105	employee	t	2026-01-07 06:03:07.709095	2026-01-07 06:03:07.709095
106	Shivam choudhary 	$2y$10$G4VgFxCXcjsb1X3sv6YN6O2uj4vbqLuQuX3tnpCXck/4nNuBYatR6	Shivam choudhary	shibuchoudhary83@gmail.com	8360375531	Surveyors	105	employee	t	2025-12-13 11:13:07.724336	2026-01-08 13:09:02.45982
138	Aradhana 	$2y$10$86MxvanE4I0IcvkvOh89UeZZf/3QVW6OCCYNo01UL.yh7zzPqvOOe	Aradhana Shah	aradhana.sah.9988@gmail.com	9693363417	IT	105	employee	t	2026-01-09 05:27:34.269138	2026-01-09 05:27:34.269138
139	aks87	$2y$10$IslRQOayPbysEtyK99FnkuLRXEROShnrauhhfHifr9oK0FOyRlbxK	ANUJ KUMAR 	aksrivastava87@gmail.com	9560755973	Accounts	79	employee	t	2026-01-10 13:20:37.093242	2026-01-10 13:20:37.093242
140	Prayaghanuai	$2y$10$t5fVp5Nggyee48RFKRktheD.YLgDiZj.4QFaQb9PuXkVA1Ut/20iq	Prayag Nair	prayagnr@gmail.com	7973349367	Others	79	employee	t	2026-01-14 03:13:34.026077	2026-01-14 03:13:34.026077
141	Tru1	$2y$10$82KufIhMOQGmH2gWfivrR.dMtO50CK9Hh9UupyxwmB0UI7xctoMF6	Tribhuwan Yadav 	tribhuwanyadav2021@gmail.com	7209612653	Surveyors	105	employee	t	2026-01-16 06:33:02.179014	2026-01-16 06:33:02.179014
\.


--
-- Data for Name: office_locations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.office_locations (id, name, address, latitude, longitude, radius_meters, is_active, created_at, updated_at) FROM stdin;
79	79 Office	Sector 79, Mohali, Punjab, India	30.68083400	76.71793300	100	t	2025-11-26 10:33:10.642254	2026-01-14 18:07:10.229088
105	105 Office	Sector 105, Mohali, Punjab, India	30.65599100	76.68279500	100	t	2025-11-26 10:33:10.642254	2026-01-14 18:08:12.773133
\.


--
-- Data for Name: wfh_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.wfh_requests (id, employee_id, requested_date, reason, status, reviewed_by, admin_response, reviewed_at, created_at, updated_at) FROM stdin;
1	7	2025-12-11	some glitch	pending	\N	\N	\N	2025-12-11 03:38:13.952269	2025-12-11 03:38:13.952269
3	2	2025-12-23	I’m at my hometown.	pending	\N	\N	\N	2025-12-23 04:20:42.495161	2025-12-23 04:20:42.495161
4	4	2026-01-12		pending	\N	\N	\N	2026-01-12 05:05:26.932017	2026-01-12 05:05:26.932017
5	133	2026-01-14	after the approval of mohneesh sir, im working from home 	pending	\N	\N	\N	2026-01-14 04:14:21.742087	2026-01-14 04:14:21.742087
6	128	2026-01-15		pending	\N	\N	\N	2026-01-15 02:49:53.460275	2026-01-15 02:49:53.460275
7	90	2026-01-15		pending	\N	\N	\N	2026-01-15 02:55:23.451352	2026-01-15 02:55:23.451352
8	85	2026-01-15	please give me access to sign in during WFH	pending	\N	\N	\N	2026-01-15 03:50:53.352078	2026-01-15 03:50:53.352078
9	129	2026-01-16	Good morning sir/ma'am. \nSir, due to heavy fog, traveling will be difficult for me, so I will work from home.	pending	\N	\N	\N	2026-01-16 03:41:58.783172	2026-01-16 03:41:58.783172
\.


--
-- Name: attendance_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.attendance_records_id_seq', 2483, true);


--
-- Name: department_office_access_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.department_office_access_id_seq', 12, true);


--
-- Name: employee_documents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.employee_documents_id_seq', 10, true);


--
-- Name: employee_profiles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.employee_profiles_id_seq', 29, true);


--
-- Name: employees_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.employees_id_seq', 141, true);


--
-- Name: wfh_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.wfh_requests_id_seq', 9, true);


--
-- Name: attendance_records attendance_records_employee_id_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_employee_id_date_key UNIQUE (employee_id, date);


--
-- Name: attendance_records attendance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_pkey PRIMARY KEY (id);


--
-- Name: department_office_access department_office_access_department_office_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.department_office_access
    ADD CONSTRAINT department_office_access_department_office_id_key UNIQUE (department, office_id);


--
-- Name: department_office_access department_office_access_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.department_office_access
    ADD CONSTRAINT department_office_access_pkey PRIMARY KEY (id);


--
-- Name: employee_documents employee_documents_employee_id_doc_type_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_documents
    ADD CONSTRAINT employee_documents_employee_id_doc_type_key UNIQUE (employee_id, doc_type);


--
-- Name: employee_documents employee_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_documents
    ADD CONSTRAINT employee_documents_pkey PRIMARY KEY (id);


--
-- Name: employee_profiles employee_profiles_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_profiles
    ADD CONSTRAINT employee_profiles_employee_id_key UNIQUE (employee_id);


--
-- Name: employee_profiles employee_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_profiles
    ADD CONSTRAINT employee_profiles_pkey PRIMARY KEY (id);


--
-- Name: employees employees_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_email_key UNIQUE (email);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: employees employees_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_username_key UNIQUE (username);


--
-- Name: office_locations office_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.office_locations
    ADD CONSTRAINT office_locations_pkey PRIMARY KEY (id);


--
-- Name: wfh_requests wfh_requests_employee_id_requested_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wfh_requests
    ADD CONSTRAINT wfh_requests_employee_id_requested_date_key UNIQUE (employee_id, requested_date);


--
-- Name: wfh_requests wfh_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wfh_requests
    ADD CONSTRAINT wfh_requests_pkey PRIMARY KEY (id);


--
-- Name: idx_attendance_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_date ON public.attendance_records USING btree (date);


--
-- Name: idx_attendance_employee_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_employee_date ON public.attendance_records USING btree (employee_id, date);


--
-- Name: idx_attendance_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_status ON public.attendance_records USING btree (status);


--
-- Name: idx_attendance_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_type ON public.attendance_records USING btree (type);


--
-- Name: idx_employee_documents; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employee_documents ON public.employee_documents USING btree (employee_id, doc_type);


--
-- Name: idx_employees_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employees_active ON public.employees USING btree (is_active);


--
-- Name: idx_employees_department; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employees_department ON public.employees USING btree (department);


--
-- Name: idx_employees_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employees_email ON public.employees USING btree (email);


--
-- Name: idx_employees_username; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employees_username ON public.employees USING btree (username);


--
-- Name: idx_wfh_employee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_wfh_employee ON public.wfh_requests USING btree (employee_id);


--
-- Name: idx_wfh_requested_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_wfh_requested_date ON public.wfh_requests USING btree (requested_date);


--
-- Name: idx_wfh_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_wfh_status ON public.wfh_requests USING btree (status);


--
-- Name: attendance_records update_attendance_records_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_attendance_records_updated_at BEFORE UPDATE ON public.attendance_records FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: employee_profiles update_employee_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_employee_profiles_updated_at BEFORE UPDATE ON public.employee_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: employees update_employees_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: office_locations update_office_locations_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_office_locations_updated_at BEFORE UPDATE ON public.office_locations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: wfh_requests update_wfh_requests_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_wfh_requests_updated_at BEFORE UPDATE ON public.wfh_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: attendance_records attendance_records_employee_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_employee_fk FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: attendance_records attendance_records_office_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_office_fk FOREIGN KEY (office_id) REFERENCES public.office_locations(id) ON DELETE SET NULL;


--
-- Name: department_office_access department_office_access_office_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.department_office_access
    ADD CONSTRAINT department_office_access_office_fk FOREIGN KEY (office_id) REFERENCES public.office_locations(id) ON DELETE CASCADE;


--
-- Name: employee_documents fk_employee_documents_employee; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_documents
    ADD CONSTRAINT fk_employee_documents_employee FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_profiles fk_employee_profiles_employee; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_profiles
    ADD CONSTRAINT fk_employee_profiles_employee FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: wfh_requests wfh_requests_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wfh_requests
    ADD CONSTRAINT wfh_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: wfh_requests wfh_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wfh_requests
    ADD CONSTRAINT wfh_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict mOghvKTWMfRnIBedrgrCZ0djRzFMm1dSKXl7C7yVbB31hXgeiRzgKK0Z7P4wmZ2

